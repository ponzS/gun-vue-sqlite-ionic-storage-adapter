/* 
  自定义适配器，使用 Gun-Flint + Ionic/Capacitor 的 SQLite (sharedStorage) 进行持久化。
  本次更新的关键点：在 put() 中对旧节点和新节点做 CRDT 合并，防止字段被覆盖丢失。
  如果遇到问题可以在x中联系我。
  注意：此适配器已实现核心思路，如需额外定制化需要更完善的错误处理、日志、特殊数据类型处理等。
*/

import { sharedStorage } from './sharedStorage'
import { Flint, NodeAdapter } from 'gun-flint'

/** 
 * 确保 sharedStorage 已经完成初始化。
 * 可在适配器初始化时多次尝试 create()，避免因延迟导致的报错。
 */
async function ensureStorage() {
  if (!sharedStorage) {
    await sharedStorage.create()
  }
  return sharedStorage
}

/** 
 * 1) CRDT 合并函数
 * - 读取旧节点 oldNode，和新节点 newNode
 * - 根据 Gun 的逻辑：对每个字段比较 state (_.>[field])，取较新的值
 * - 避免覆盖丢失老字段
 */
function mergeCRDT(oldNode: any, newNode: any) {
  // 如果旧节点不存在，则直接返回新节点
  if (!oldNode) {
    return newNode
  }
  if (!oldNode._ || !oldNode._['>']) {
    // 旧节点不含任何metadata，直接用新节点
    return newNode
  }
  if (!newNode._ || !newNode._['>']) {
    // 新节点没有metadata，可能是异常？
    // 视需求可直接返回 oldNode，或将其简单覆盖
    return oldNode
  }

  const merged = JSON.parse(JSON.stringify(oldNode)) // 拷贝旧节点
  const oldState = merged._['>']
  const newState = newNode._['>']

  // 遍历 newNode 的每个字段
  for (const field in newNode) {
    if (field === '_') continue // 跳过 metadata
    const newVal = newNode[field]
    const newValState = newState[field]

    // 如果旧节点没有此字段，则直接用新字段
    if (merged[field] === undefined) {
      merged[field] = newVal
      merged._['>'][field] = newValState
    } else {
      // 否则比较 state 值
      const oldValState = oldState[field] || 0
      if (newValState > oldValState) {
        // 新值更新
        merged[field] = newVal
        merged._['>'][field] = newValState
      }
      // 如果新值 state 不大于旧值，保持旧值不变
    }
  }

  return merged
}

/** 
 * 2) 适配器的核心实现
 */
const gunIonicAdapter = new NodeAdapter({

  // ------------------------------------------------------
  // opt(context, options):
  //   - 初始化时调用，把 sharedStorage 实例挂载到 this.storage
  // ------------------------------------------------------
  opt: async function (context: any, options: any) {
    console.log("Gun-Vue-Sqlite-Adapter: opt() called. context:", context, "options:", options)
    const storageInstance = await ensureStorage()
    this.storage = storageInstance
    return options
  },

  // ------------------------------------------------------
  // get(key, field, done):
  //   - 读取数据并返回给 Gun
  //   - field 可能是回调，也可能是“要读取的字段”
  //   - 一般情况下可直接返回完整 node 给 Gun，Gun会自行按字段映射
  // ------------------------------------------------------
  get: async function (key: string, field: any, done: (err: any, data?: any) => void) {
    console.log("Gun-Vue-Sqlite-Adapter: get() called. key =", key, "field =", field)

    // 兼容 (key, callback) 调用方式
    if (typeof field === 'function' && done === undefined) {
      done = field
      field = null
    }
    if (typeof done !== 'function') {
     // console.warn("No callback function in get() call. key=", key)
      return
    }
    if (!key) {
    //  console.warn("get() with empty key => returning null")
      return done(null, null)
    }

    try {
      const storageInstance = this.storage || await ensureStorage()

      // ============== 处理自定义命令 ==============
      if (field && field.__command === 'paginate') {
        // 例如分页读取
        // field 里可包含 { chatId, offset, limit }
        const chatId = field.chatId
        const offset = field.offset || 0
        const limit = field.limit || 10

        const allKeys = await storageInstance.keys()
        const chatKeys = allKeys.filter((k: string) => k.startsWith(chatId))
        chatKeys.sort()

        const selected = chatKeys.slice(offset, offset + limit)
        const result: Record<string, any> = {}
        for (const ck of selected) {
          result[ck] = await storageInstance.get(ck)
        }
        console.log("分页查询返回：", result)
        return done(null, result)
      }
      // ============== 常规读取 ==============
      const dataStr = await storageInstance.get(key)
      if (!dataStr) {
        // 若 storage 中没此 key
        return done(null, null)
      }
      console.log(`Gun-Vue-Sqlite-Adapter: get(key=${key}) => found data.`)
      // JSON.parse
      let data
      try {
        data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr
      } catch (e) {
        console.warn(`解析存储中 key=${key} 时出错:`, e)
        data = dataStr
      }
      return done(null, data)

    } catch (error) {
      console.error("Gun-Vue-Sqlite-Adapter: get error =>", error)
      return done(error)
    }
  },

  // ------------------------------------------------------
  // put(node, done):
  //   - 把 Gun 传来的增量节点存入数据库
  //   - 如果 node.__command 存在，则执行特殊指令
  //   - 否则先读旧节点 => CRDT 合并 => 写回
  // ------------------------------------------------------
  put: async function (node: any, done: (err: any, result?: any) => void) {
    console.log("Gun-Vue-Sqlite-Adapter: put() called. node =", node)

    if (typeof done !== 'function') {
      console.warn("No callback in put() call. node=", node)
      return
    }

    try {
      const storageInstance = this.storage || await ensureStorage()

      // ============== 特殊命令 ==============
      if (node && node.__command) {
        switch (node.__command) {
          case 'remove':
            if (node.key) {
              await storageInstance.remove(node.key)
              console.log(`remove 命令成功，key=${node.key}`)
              return done(null)
            } else {
              throw new Error("remove 命令必须提供 key")
            }

          case 'clear':
            await storageInstance.clear()
            console.log("clear 命令成功, 已清空全部存储")
            return done(null)

          case 'keys': {
            const keys = await storageInstance.keys()
            console.log("keys 命令成功 =>", keys)
            return done(null, keys)
          }

          case 'length': {
            const len = await storageInstance.length()
            console.log("length 命令成功 =>", len)
            return done(null, len)
          }

          case 'forEach': {
            let items: any[] = []
            await storageInstance.forEach((value: any, key: any, index: any) => {
              items.push({ key, value, index })
            })
            console.log("forEach 命令完成 =>", items)
            return done(null, items)
          }

          case 'set': {
            if (node.key !== undefined && node.value !== undefined) {
              await storageInstance.set(node.key, node.value)
              console.log("set 命令成功, key =", node.key)
              return done(null)
            } else {
              throw new Error("set 命令必须提供 key 和 value")
            }
          }

          case 'paginate': {
            // 示例分页
            if (node.key === undefined) {
              throw new Error("paginate 命令必须提供 key")
            }
            const allKeys = await storageInstance.keys()
            const filteredKeys = allKeys.filter((k: any) => k.startsWith(node.key))
            filteredKeys.sort()
            const offset = node.offset || 0
            const limit = node.limit || 10
            const pageKeys = filteredKeys.slice(offset, offset + limit)

            let pageData = []
            for (const k of pageKeys) {
              const dt = await storageInstance.get(k)
              pageData.push({ key: k, data: dt })
            }
            console.log("paginate 命令 => ", pageData)
            return done(null, pageData)
          }

          default:
            throw new Error("未知命令类型: " + node.__command)
        }
      }

      // ============== 常规存储 (CRDT 合并) ==============
      // node._.# (或 node._.id) 就是此节点的 soul
      const soul = (node._ && (node._['#'] || node._.id)) as string
      if (!soul) {
        throw new Error("put() 失败：node 缺少 _.# 或 _.id")
      }

      // 1) 读取已存在的数据
      const oldDataStr = await storageInstance.get(soul)
      let oldNode: any = null
      if (oldDataStr) {
        try {
          oldNode = JSON.parse(oldDataStr)
        } catch (e) {
          console.warn("解析旧节点出错, 将用空替代 =>", e)
        }
      }

      // 2) CRDT 合并
      const merged = mergeCRDT(oldNode, node)

      // 3) 写回
      await storageInstance.set(soul, JSON.stringify(merged))
      console.log(`成功存储节点 soul=${soul}`)

      return done(null)

    } catch (error) {
      console.error("Gun-Vue-Sqlite-Adapter: put error =>", error)
      return done(error)
    }
  },

})

// 注册到 Flint
Flint.register(gunIonicAdapter)
console.log("Gun-Vue-Sqlite-Adapter 注册完成！")

export default gunIonicAdapter
