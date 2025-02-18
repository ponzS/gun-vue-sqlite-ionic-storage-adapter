// gun-ionic-adapter.ts
import { sharedStorage } from './sharedStorage'
import { Flint, NodeAdapter } from 'gun-flint'

async function ensureStorage() {
  if (!sharedStorage) {
    // sharedStorage 在模块加载时已经初始化，但这里做个保险
    await sharedStorage.create();
  }
  return sharedStorage;
}

const gunIonicAdapter = new NodeAdapter({
  // --------------------------------------------------------------------------
  // 1) opt(context, options): 在初始化时同步获取 storage
  // --------------------------------------------------------------------------
  opt: async function (context: any, options: any) {
    console.log("适配器初始化：opt 被调用。上下文：", context, "选项：", options);

    // 同步await：确保后续 this.storage 已就绪
    const storageInstance = await ensureStorage();
    this.storage = storageInstance; 
    
    // 如果只想在 get/put 时每次都 ensureStorage() 也可以；这里做一次性赋值
    return options;
  },

  // --------------------------------------------------------------------------
  // 2) get(key, field, done):
  //    - 检查若只有两个参数，field 其实是回调
  //    - 检查 done 是否函数
  //    - 分页或普通读取
  // --------------------------------------------------------------------------
  get: async function (key: string, field: any, done: (err: any, data?: any) => void) {
    console.log("适配器 get 被调用。key =", key, "field =", field);
    
    // 兼容：若只传了 (key, callback) 两参数，field就是回调
    if (typeof field === 'function' && done === undefined) {
      done = field;
      field = null;
    }
    // 确保 done 是函数，否则跳过
    if (typeof done !== 'function') {
      console.warn("No valid callback function was passed to get(). key=", key);
      return;
    }

    if (!key) {
      console.warn("get 方法调用时 key 为空，忽略该调用");
      return done(null, null);
    }
    if (typeof key !== 'string') {
      key = String(key);
    }

    try {
      const storageInstance = this.storage || await ensureStorage();

      // 如果是分页
      if (field && field.__command === 'paginate') {
        // 假设 field 里带 { __command:'paginate', chatId, offset, limit }
        const chatId = field.chatId; 
        const offset = field.offset || 0;
        const limit = field.limit || 10;

        const allKeys = await storageInstance.keys();
        const chatKeys = allKeys.filter((k: string) => k.startsWith(chatId));
        chatKeys.sort();

        const selected = chatKeys.slice(offset, offset + limit);
        const result: Record<string, any> = {};
        for (const k of selected) {
          result[k] = await storageInstance.get(k);
        }
        console.log("分页查询返回数据：", result);
        return done(null, result);

      } else {
        // 正常读取
        const data = await storageInstance.get(key);
        console.log("成功读取 key =", key, "数据：", data);
        return done(null, data);
      }
    } catch (error) {
      console.error("读取 key =", key, "数据时出错：", error);
      return done(error);
    }
  },

  // --------------------------------------------------------------------------
  // 3) put(node, done):
  //    - 如果 node.__command 存在，则执行特殊逻辑
  //    - 否则把 node 当成 Gun 的整节点
  // --------------------------------------------------------------------------
  put: async function (node: any, done: (err: any, result?: any) => void) {
    console.log("适配器 put 被调用。节点数据：", node);

    // 若 done 不是函数，跳过
    if (typeof done !== 'function') {
      console.warn("No valid callback function was passed to put(). node=", node);
      // 也可 return console.warn(...) 仅提示不回调
      return;
    }

    try {
      const storageInstance = this.storage || await ensureStorage();

      // 4) 特殊命令
      if (node && node.__command) {
        switch (node.__command) {
          case 'remove':
            if (node.key) {
              await storageInstance.remove(node.key);
              console.log(`删除成功，key = ${node.key}`);
              return done(null);
            } else {
              throw new Error("remove 命令必须提供 key");
            }

          case 'clear':
            await storageInstance.clear();
            console.log("清除所有数据成功");
            return done(null);

          case 'keys': {
            const keys = await storageInstance.keys();
            console.log("获取 keys 成功", keys);
            return done(null, keys);
          }

          case 'length': {
            const len = await storageInstance.length();
            console.log("获取长度成功", len);
            return done(null, len);
          }

          case 'forEach': {
            let items: any[] = [];
            await storageInstance.forEach((value: any, key: any, index: any) => {
              items.push({ key, value, index });
            });
            console.log("forEach 遍历结果", items);
            return done(null, items);
          }

          case 'set': {
            if (node.key !== undefined && node.value !== undefined) {
              await storageInstance.set(node.key, node.value);
              console.log("特殊 set 成功", node.key);
              return done(null);
            } else {
              throw new Error("set 命令必须提供 key 和 value");
            }
          }

          case 'paginate': {
            // 示例分页命令
            if (node.key === undefined) {
              throw new Error("paginate 命令必须提供 key");
            }
            const allKeys = await storageInstance.keys();
            const filteredKeys = allKeys.filter((k: any) => k.startsWith(node.key));
            filteredKeys.sort();
            const offset = node.offset || 0;
            const limit = node.limit || 10;
            const pageKeys = filteredKeys.slice(offset, offset + limit);

            let pageData = [];
            for (const k of pageKeys) {
              const dt = await storageInstance.get(k);
              pageData.push({ key: k, data: dt });
            }
            console.log("分页数据", pageData);
            return done(null, pageData);
          }

          default:
            throw new Error("未知的命令类型: " + node.__command);
        }
      }

      // 5) 如果没有特殊命令，则进行正常的存储操作
      const key = node._ && node._.id; 
      if (!key) {
        throw new Error("节点必须具有 _.id 属性才能存储。");
      }

      await storageInstance.set(key, node);
      console.log("成功存储节点，key =", key);

      return done(null);

    } catch (error) {
      console.error("存储节点失败，节点：", node, "错误：", error);
      return done(error);
    }
  },
});

// 向 Flint 注册适配器
Flint.register(gunIonicAdapter);
console.log("Gun Ionic Adapter 注册完成！");

export default gunIonicAdapter;
