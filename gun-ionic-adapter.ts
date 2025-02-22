/* 
  自定义适配器，使用 Gun-Flint + Ionic/Capacitor 的 SQLite (sharedStorage) 进行持久化。
  本次升级关键点：
  - 性能优化：批量操作、缓存热点数据、减少 JSON 开销。
  - 处理GUN带来的数据海啸：请求队列、防抖机制。
  - CRDT 合并：支持嵌套对象。
  - SQLite 持久性：运行时缓存与 SQLite 深度整合，启动时恢复。
  - 如需帮助，可在 X 上联系我。
*/

import { sharedStorage } from './sharedStorage';
import { Flint, NodeAdapter } from 'gun-flint';

// 简单日志工具
const log = {
  debug: (msg: string, ...args: any[]) => console.debug(`[Gun-Vue-Sqlite] ${msg}`, ...args),
  info: (msg: string, ...args: any[]) => console.info(`[Gun-Vue-Sqlite] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[Gun-Vue-Sqlite] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[Gun-Vue-Sqlite] ${msg}`, ...args),
};

/** 
 * 确保 sharedStorage 初始化，支持重试。
 */
async function ensureStorage(maxRetries = 3, retryDelay = 500): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (!sharedStorage) await sharedStorage.create();
      return sharedStorage;
    } catch (err: any) {
      log.warn(`Storage init attempt ${i + 1} failed:`, err);
      if (i === maxRetries - 1) throw new Error(`Failed to init storage after ${maxRetries} retries: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

/** 
 * CRDT 合并函数（支持嵌套对象）
 */
function mergeCRDT(oldNode: any, newNode: any): any {
  if (!oldNode) return { ...newNode };
  if (!newNode) return { ...oldNode };

  const oldMeta = oldNode._ && oldNode._['>'] ? oldNode._['>'] : {};
  const newMeta = newNode._ && newNode._['>'] ? newNode._['>'] : {};
  const merged = { ...oldNode, _: { ...oldNode._, '>': { ...oldMeta } } };

  for (const field in newNode) {
    if (field === '_') continue;
    const newVal = newNode[field];
    const newState = newMeta[field] || Date.now();

    if (!(field in oldNode)) {
      merged[field] = newVal;
      merged._['>'][field] = newState;
    } else if (typeof newVal === 'object' && typeof oldNode[field] === 'object' && newVal !== null && oldNode[field] !== null) {
      merged[field] = mergeCRDT(oldNode[field], newVal);
    } else {
      const oldState = oldMeta[field] || 0;
      if (newState > oldState) {
        merged[field] = newVal;
        merged._['>'][field] = newState;
      }
    }
  }
  return merged;
}

/**
 * 请求队列和缓存（与 SQLite 深度整合）
 */
class RequestQueue {
  private queue: Map<string, { resolve: (data: any) => void; reject: (err: any) => void }[]> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private storage: any;
  private cacheTTL = 24 * 60 * 60 * 1000; // 缓存有效期：24小时

  constructor(storage: any) {
    this.storage = storage;
    this.initCache();
  }

  // 初始化时从 SQLite 恢复缓存
  async initCache() {
    try {
      const cachedData = await this.storage.get('persistentCache');
      if (cachedData) {
        this.cache = new Map(JSON.parse(cachedData));
        // 检查缓存有效性
        const now = Date.now();
        for (const [key, { timestamp }] of this.cache) {
          if (now - timestamp > this.cacheTTL) {
            this.cache.delete(key);
          }
        }
        await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
      }
    } catch (err) {
      log.error('Failed to initialize cache from storage:', err);
    }
  }

  // 获取数据（优先缓存）
  async get(key: string): Promise<any> {
    if (this.cache.has(key)) {
      const { data, timestamp } = this.cache.get(key)!;
      if (Date.now() - timestamp < this.cacheTTL) {
        log.debug(`Cache hit for key=${key}`);
        return data;
      } else {
        this.cache.delete(key); // 过期则移除
      }
    }

    return new Promise((resolve, reject) => {
      const handlers = this.queue.get(key) || [];
      handlers.push({ resolve, reject });
      this.queue.set(key, handlers);

      if (!this.debounceTimers.has(key)) {
        const timer = setTimeout(async () => {
          const handlers = this.queue.get(key) || [];
          this.queue.delete(key);
          this.debounceTimers.delete(key);

          try {
            const dataStr = await this.storage.get(key);
            const data = dataStr ? JSON.parse(dataStr) : null;
            this.cache.set(key, { data, timestamp: Date.now() });
            await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
            handlers.forEach(h => h.resolve(data));
          } catch (err) {
            handlers.forEach(h => h.reject(err));
          }
        }, 50);
        this.debounceTimers.set(key, timer);
      }
    });
  }

  // 写入数据（批量）
  async put(soul: string, node: any): Promise<void> {
    const oldData = await this.get(soul);
    const merged = mergeCRDT(oldData, node);
    await this.storage.set(soul, JSON.stringify(merged));
    this.cache.set(soul, { data: merged, timestamp: Date.now() });
    await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
  }

  // 批量写入
  async batchPut(nodes: Record<string, any>): Promise<void> {
    const updates: [string, string][] = [];
    for (const soul in nodes) {
      const oldData = await this.get(soul);
      const merged = mergeCRDT(oldData, nodes[soul]);
      updates.push([soul, JSON.stringify(merged)]);
      this.cache.set(soul, { data: merged, timestamp: Date.now() });
    }
    // 批量写入
    await Promise.all(updates.map(([key, value]) => this.storage.set(key, value)));
    await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
  }

  // 清理缓存
  async clearCache() {
    this.cache.clear();
    await this.storage.remove('persistentCache');
  }
}

/**
 * 适配器核心实现
 */
const gunIonicAdapter = new NodeAdapter({
  opt: async function (context: any, options: any) {
    log.info('Adapter initialized:', { context, options });
    const storageInstance = await ensureStorage();
    this.storage = storageInstance;
    this.queue = new RequestQueue(storageInstance);

    // 预加载热点数据（例如 buddyList）
    try {
      const buddyList = await this.queue.get('buddyList');
      if (buddyList) {
        log.info('Preloaded buddyList from cache');
      }
    } catch (err) {
      log.warn('Failed to preload buddyList:', err);
    }

    return options;
  },

  get: async function (key: string, field: any, done: (err: any, data?: any) => void) {
    log.debug(`get called: key=${key}, field=`, field);

    if (typeof field === 'function' && !done) {
      done = field;
      field = null;
    }
    if (typeof done !== 'function') return;

    try {
      if (!key) return done(null, null);

      if (field && field.__command === 'paginate') {
        const chatId = field.chatId;
        const offset = field.offset || 0;
        const limit = field.limit || 10;
        const allKeys = await this.storage.keys();
        const chatKeys = allKeys.filter((k: string) => k.startsWith(chatId)).sort();
        const selected = chatKeys.slice(offset, offset + limit);
        const result: Record<string, any> = {};

        await Promise.all(selected.map(async (ck: string) => {
          result[ck] = await this.queue.get(ck);
        }));
        return done(null, result);
      }

      const data = await this.queue.get(key);
      return done(null, data);
    } catch (err) {
      log.error(`get error: key=${key}`, err);
      return done(err);
    }
  },

  put: async function (node: any, done: (err: any, result?: any) => void) {
    log.debug('put called:', node);

    if (typeof done !== 'function') return;

    try {
      if (typeof node !== 'object' || node === null) throw new Error('Invalid node');

      if (node && node.__command) {
        switch (node.__command) {
          case 'remove':
            if (!node.key) throw new Error('remove requires key');
            await this.storage.remove(node.key);
            await this.queue.clearCache();
            return done(null);

          case 'clear':
            await this.storage.clear();
            await this.queue.clearCache();
            return done(null);

          case 'keys':
            const keys = await this.storage.keys();
            return done(null, keys);

          case 'length':
            const len = await this.storage.length();
            return done(null, len);

          case 'forEach':
            const items: any[] = [];
            await this.storage.forEach((value: any, key: any, index: any) => items.push({ key, value, index }));
            return done(null, items);

          case 'set':
            if (node.key === undefined || node.value === undefined) throw new Error('set requires key and value');
            await this.storage.set(node.key, node.value);
            await this.queue.clearCache();
            return done(null);

          case 'paginate':
            if (!node.key) throw new Error('paginate requires key');
            const allKeys = await this.storage.keys();
            const filteredKeys = allKeys.filter((k: string) => k.startsWith(node.key)).sort();
            const offset = node.offset || 0;
            const limit = node.limit || 10;
            const pageKeys = filteredKeys.slice(offset, offset + limit);
            const pageData = await Promise.all(pageKeys.map(async (k: string) => ({ key: k, data: await this.queue.get(k) })));
            return done(null, pageData);

          default:
            throw new Error(`Unknown command: ${node.__command}`);
        }
      }

      const souls = Object.keys(node).length > 1 ? Object.keys(node) : [node._?.['#'] || node._.id];
      if (!souls[0]) throw new Error('Missing soul in node');

      if (souls.length > 1) {
        await this.queue.batchPut(node); // 使用批量写入
      } else {
        await this.queue.put(souls[0], node[souls[0]] || node);
      }
      return done(null);
    } catch (err) {
      log.error('put error:', err);
      return done(err);
    }
  },
});

// 注册到 Flint
Flint.register(gunIonicAdapter);
log.info('Gun-Vue-Sqlite-Adapter registered!');
export default gunIonicAdapter;
