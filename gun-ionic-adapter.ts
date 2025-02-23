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

  constructor(storage: any) {
    this.storage = storage;
    this.initCache();
  }

  async initCache() {
    try {
      const cachedData = await this.storage.get('persistentCache');
      if (cachedData) {
        this.cache = new Map(JSON.parse(cachedData));
        log.info('Cache restored from storage');
      }
    } catch (err) {
      log.error('Failed to initialize cache from storage:', err);
    }
  }

  async get(key: string): Promise<any> {
    if (this.cache.has(key)) {
      const { data } = this.cache.get(key)!;
      log.debug(`Cache hit for key=${key}`);
      return data;
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

  async put(soul: string, node: any): Promise<void> {
    const oldData = await this.get(soul);
    const merged = mergeCRDT(oldData, node);
    await this.storage.set(soul, JSON.stringify(merged));
    this.cache.set(soul, { data: merged, timestamp: Date.now() });
    await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
  }

  async batchPut(nodes: Record<string, any>): Promise<void> {
    const updates: [string, string][] = [];
    for (const soul in nodes) {
      const oldData = await this.get(soul);
      const merged = mergeCRDT(oldData, nodes[soul]);
      updates.push([soul, JSON.stringify(merged)]);
      this.cache.set(soul, { data: merged, timestamp: Date.now() });
    }
    await Promise.all(updates.map(([key, value]) => this.storage.set(key, value)));
    await this.storage.set('persistentCache', JSON.stringify([...this.cache]));
  }

  async clearCache(): Promise<void> {
    try {
      this.cache.clear();
      await this.storage.remove('persistentCache');
      log.info('Cache cleared manually');
    } catch (err) {
      log.error('Failed to clear cache:', err);
      throw err;
    }
  }

  // 估算缓存的内存占用（字节）
  getCacheMemoryUsage(): number {
    let totalBytes = 0;

    for (const [key, value] of this.cache) {
      // 键的字节数（UTF-16）
      const keyBytes = key.length * 2 + 8;

      // 值的字节数
      const timestampBytes = 8;
      const dataBytes = this.estimateObjectSize(value.data);

      // Map 键值对开销（粗略估计）
      const entryOverhead = 32;

      totalBytes += keyBytes + timestampBytes + dataBytes + entryOverhead;
    }

    return totalBytes;
  }

  // 估算对象的字节数（递归计算）
  private estimateObjectSize(obj: any): number {
    if (obj === null || obj === undefined) return 0;

    if (typeof obj === 'string') return obj.length * 2 + 8;
    if (typeof obj === 'number') return 8;
    if (typeof obj === 'boolean') return 8; // 对齐后通常占 8 字节

    if (typeof obj === 'object') {
      let size = 40; // 空对象的基础开销
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          size += key.length * 2 + 8; // 属性名
          size += this.estimateObjectSize(obj[key]); // 属性值
        }
      }
      return size;
    }

    return 0; // 其他类型忽略
  }

  getCacheStatus(): { size: number; memoryBytes: number } {
    return {
      size: this.cache.size,
      memoryBytes: this.getCacheMemoryUsage(),
    };
  }
}

// 定义适配器核心逻辑
const adapterCore = {
  storage: null as any,
  queue: null as RequestQueue | null,
  opt: async function (context: any, options: any) {
    log.info('Adapter opt called:', { context, options });
    this.storage = await ensureStorage();
    this.queue = new RequestQueue(this.storage);

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
          result[ck] = await this.queue!.get(ck);
        }));
        return done(null, result);
      }

      const data = await this.queue!.get(key);
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
            log.info(`Key ${node.key} removed from storage`);
            return done(null);

          case 'clear':
            await this.storage.clear();
            log.info('Storage cleared');
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
            log.info(`Key ${node.key} set in storage`);
            return done(null);

          case 'paginate':
            if (!node.key) throw new Error('paginate requires key');
            const allKeys = await this.storage.keys();
            const filteredKeys = allKeys.filter((k: string) => k.startsWith(node.key)).sort();
            const offset = node.offset || 0;
            const limit = node.limit || 10;
            const pageKeys = filteredKeys.slice(offset, offset + limit);
            const pageData = await Promise.all(pageKeys.map(async (k: string) => ({ key: k, data: await this.queue!.get(k) })));
            return done(null, pageData);

          default:
            throw new Error(`Unknown command: ${node.__command}`);
        }
      }

      const souls = Object.keys(node).length > 1 ? Object.keys(node) : [node._?.['#'] || node._.id];
      if (!souls[0]) throw new Error('Missing soul in node');

      if (souls.length > 1) {
        await this.queue!.batchPut(node);
      } else {
        await this.queue!.put(souls[0], node[souls[0]] || node);
      }
      return done(null);
    } catch (err) {
      log.error('put error:', err);
      return done(err);
    }
  },
};

// 创建适配器实例并注册到 Flint
const adapterInstance = new NodeAdapter(adapterCore);
Flint.register(adapterInstance);

// 初始化并导出适配器
const gunIonicAdapter = {
  clearCache: async () => {
    if (!adapterCore.queue) throw new Error('Adapter not initialized');
    await adapterCore.queue.clearCache();
  },
  getCacheStatus: () => {
    if (!adapterCore.queue) throw new Error('Adapter not initialized');
    return adapterCore.queue.getCacheStatus();
  },
};

// 立即初始化
(async () => {
  await adapterCore.opt({}, {});
  log.info('Gun-Vue-Sqlite-Adapter registered and initialized!');
})();

export default gunIonicAdapter;
