# gun-vue-sqlite-ionic-storage-adapter

<img width="650" alt="image" src="https://github.com/user-attachments/assets/cc61333e-192a-47ea-bea5-22ff03a21266" />

This is a storage adapter for gun.js, designed specifically for mobile devices built with Vue. It enhances the persistence capabilities of gun’s network storage in Vue. It supports iOS and Android.
For web environments, please disable this adapter and enable IndexedDB instead, and on Windows/macOS, it is recommended to use the File System API.

Currently, this solution is considered reliable as it has passed rigorous stress tests and has been applied in real-world projects.

Considering various complex usage scenarios, this repository provides only a basic demonstration and an extensible module. You are welcome to extend it according to your own needs.

Prerequisites for Vue Templates

# Install gun
```bash
yarn add gun
```
# Install gun-flint
```bash
yarn add gun-flint
```
# Install @ionic/storage
```bash
yarn add @ionic/storage
```
# Install the SQLite Driver
```bash
yarn add localforage-cordovasqlitedriver
```
For more details on the gun-vue pluggable component, please visit:
https://github.com/DeFUCC/gun-vue

For more details on @ionic/storage, please visit:
https://github.com/ionic-team/ionic-storage

# Setup & Initialization
Copy all the repository code into your project. Then, initialize as follows:
```bash
import './gun-ionic-adapter' 
import { sharedStorage } from './sharedStorage'; 
sharedStorage.create().then(() => {
  console.log('sqlite 初始化完成');
});


const storage = sharedStorage

  const gun = Gun({
   gunIonicAdapter: {
  
   },
  
   peers: [''],
   IndexedDB: false,
   localStorage: false,
   radisk: false,
   axe:true
 })

 const user = gun.user()
```

If the adapter starts successfully, you will see a confirmation message in the console.

The initialization order is crucial! Be sure to complete the shared storage initialization before initializing gun.

# Adapter Extension Details
@ionic/storage automatically generates the corresponding database operation commands based on your configuration. For example:
```bash
storage.remove  // will automatically generate: DELETE FROM users WHERE id = ;
```

If you prefer manual control over the database, you can use @capacitor-community/sqlite instead of the localforage-cordovasqlitedriver. Mount it in the opt option and implement your database control code within the get and put methods. The principle remains the same as shown in this repository’s example—only replacing storageInstance.remove(node.key) with your own SQL code.

# Adapter Code Example
```bash
 case 'remove':
            if (node.key) {
              await storageInstance.remove(node.key);
              console.log(`删除成功，key = ${node.key}`);
              return done(null);
            } else {
              throw new Error("remove 命令必须提供 key");
            }
```
# Usage Example
```bash
  gun.get('user').put({ __command: 'remove', key: ' iPad' });
```
In this example, the basic data of a user is retrieved and the remove command is executed to target their iPad.
Note: Although you have issued the remove command (i.e., “destroyed” the iPad), remnants of the iPad remain because this is a distributed network. We cannot truly delete data unless all nodes that store the data remove it simultaneously—which is nearly impossible. In terms of storage, the disk might end up inundated like a tsunami, but the real-time synchronization latency remains minimal.

# Pagination & Chunked Storage
For pagination, you can use chunked storage and retrieval. For example:
```bash
  .get('chunks')
  .get(String(latestChunk))
  .get(momentId)
  .put(momentData);
```

# Application-Level Storage Strategy
Next, let’s discuss an application-level storage strategy aimed at blocking the influx of old messages. Essentially, this is a dual-storage approach—using two local persistent databases or a combination of sqlite and IndexedDB.

Assume you choose sqlite + IndexedDB. By default, gun will prioritize IndexedDB. In this approach, gun is used solely for data synchronization, while the actual data is stored on the local disk via sqlite. Meanwhile, gun’s storage is entirely cleared to prevent a data “tsunami.”

If you disable gun’s default storage entirely, data will be written only to memory, so an automatic cleanup mechanism is strongly recommended.

You will need to design your own synchronization logic and cleanup mechanism between gun and sqlite based on your requirements. For example, you might add an internal method to save data to sqlite when sending data, or modify the adapter to implement selective automatic synchronization. Due to the relatively simple concept but significant amount of code required, a full example is not provided here. Feel free to experiment with these suggestions if you have similar needs.


# Update log

Version 1.1

Newly added

1. Cache priority policy

2. Cache management visualization components and interfaces


# Final Thanks
A heartfelt thank you to all the open source contributors—no one can do everything alone. Our collective efforts will create a better world.



 




# 中文


这是一个gunjs的储存适配器。
为使用VUE制作的移动设备针对性设计。增强vue中的gun网络储存持久化的能力。
支持iOS和安卓，web环境中请卸载适配器启用indexedDB，Windows和MacOS建议使用file system API

目前来看它是一个可靠的方案，因为已经通过了各项严格的压力测试并应用于真实项目中。

考虑到各种复杂的使用场景，本仓库仅提供基础演示和可扩展模块，可以根据你的需要自行扩展。

vue模版的前期准备：

# 安装 gun
```bash
yarn add gun
```
# 安装 gun-flint
```bash
yarn add gun-flint
```
# 安装 @ionic/storage
```bash
yarn add @ionic/storage
```
# 安装 sqlite 驱动
```bash
yarn add localforage-cordovasqlitedriver
```
关于gun-vue可插拔组件请访问
https://github.com/DeFUCC/gun-vue

关于@ionic/storage请访问
https://github.com/ionic-team/ionic-storage

将仓库中的所有代码复制到你的项目
初始化：
```bash
import './gun-ionic-adapter' 
import { sharedStorage } from './sharedStorage'; 
sharedStorage.create().then(() => {
  console.log('sqlite 初始化完成');
});


const storage = sharedStorage

  const gun = Gun({
   gunIonicAdapter: {
  
   },
  
   peers: [''],
   IndexedDB: false,
   localStorage: false,
   radisk: false,
   axe:true
 })

 const user = gun.user()
```

如果适配器启动成功在控制台中会提示你

不过注意顺序！必须在共享储存初始化完成后再初始化gun

关于适配器扩展的说明：
@ionic/storage会根据你的配置自动生成对应的数据库操作指令
例如：
```bash
storage.remove 会自动生成 DELETE FROM users WHERE id = ;
```

我们将这个自动驾驶特性加入了gun储存适配器中，您将极速完成跨平台的数据库控制需求。
如果您希望手动控制数据库，请使用@capacitor-community/sqlite替代localforage-cordovasqlitedriver
在opt中挂载，在get与put中编写您的数据库控制相关代码。与本仓库示例原理一致，只是将storageInstance.remove(node.key)替代为sql代码

适配器代码示例
```bash
 case 'remove':
            if (node.key) {
              await storageInstance.remove(node.key);
              console.log(`删除成功，key = ${node.key}`);
              return done(null);
            } else {
              throw new Error("remove 命令必须提供 key");
            }
```
使用示例：
```bash
  gun.get('user').put({ __command: 'remove', key: ' iPad' });
```
  得到某人的基本数据，执行remove，指向他的iPad。OK 你成功砸坏了他的iPad，但他的iPad残骸依然存在，因为这里是分布式网络。
        我们无法真正意义上的删除某个数据，除非拥有该数据的节点全部同时删除，但这难如登天。
        对于储存来看，硬盘会像发生海啸一样。但它的实时同步延迟是最低的。

关于分页您可以使用分块储存与读取，例如：
```bash
  .get('chunks')
  .get(String(latestChunk))
  .get(momentId)
  .put(momentData);
```

接下来我们来讨论关于应用层储存方案，这个方案主要目的是为了尽可能的阻断旧消息涌入
这里实际上是双储存，也就是使用2个本地持久化的数据库，或者是你也可以使用sqlite+indexedDB
假设这里是sqlite+indexedDB
gun默认情况下会优先使用indexedDB，我们只使用gun同步数据而将真正的数据通过sqlite储存在本地磁盘中，同时清空gun储存中的全部数据，确保海啸不会发生。
如果你将gun的默认储存全部关闭它会将数据写入内存中，所以建议自动清理方案。

这里你需要根据你自己的需求来编写gun与sqlite的同步逻辑与清除机制
例如在发送数据的接口中新增一个内置的保存到sqlite中的方法，或者是直接在适配器中改写你的自动选择性同步的
        因为这个方案过于简单但却又有比较多的代码量，所以本人不手写了，如果您有类似的需求可以尝试我的建议。


# 更新日志
version 1.1
新增
1.缓存优先策略
2.缓存管理可视化组件与接口







  # 最后
  非常感谢开源贡献者们提供的帮助，一个人无法完成全部的工作，我们共同的付出会带来更美好的世界。




 
