# gun-vue-sqlite-ionic-storage-adapter





这是一个gunjs的储存适配器。
为使用VUE制作的移动设备针对性设计。增强vue中的gun网络储存持久化的能力。
目前来看它是一个可靠的方案，因为已经通过了各项严格的压力测试并应用于真实项目中。

考虑到各种复杂的使用场景，本仓库仅提供基础演示和可扩展模块，可以根据你的需要自行扩展。

vue模版的前期准备：

# 安装 gun
yarn add gun

# 安装 gun-flint
yarn add gun-flint

# 安装 @ionic/storage
yarn add @ionic/storage

# 安装 sqlite 驱动
yarn add localforage-cordovasqlitedriver

关于gun-vue可插拔组件请访问
https://github.com/DeFUCC/gun-vue

关于@ionic/storage请访问
https://github.com/ionic-team/ionic-storage

将仓库中的所有代码复制到你的项目
初始化：
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


如果适配器启动成功在控制台中会提示你

不过注意顺序！必须在共享储存初始化完成后再初始化gun

关于适配器扩展的说明：
@ionic/storage会根据你的配置自动生成对应的数据库操作指令
例如：
storage.remove 会自动生成 DELETE FROM users WHERE id = ;

我们将这个自动驾驶特性加入了gun储存适配器中，您将极速完成跨平台的数据库控制需求。
如果您希望手动控制数据库，请使用@capacitor-community/sqlite替代localforage-cordovasqlitedriver
在opt中挂载，在get与put中编写您的数据库控制相关代码。与本仓库示例原理一致，只是将storageInstance.remove(node.key)替代为sql代码

适配器代码示例
 case 'remove':
            if (node.key) {
              await storageInstance.remove(node.key);
              console.log(`删除成功，key = ${node.key}`);
              return done(null);
            } else {
              throw new Error("remove 命令必须提供 key");
            }
使用示例：
  gun.get('user').put({ __command: 'remove', key: ' iPad' });
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

  最后非常感谢开源贡献者们提供的帮助，一个人无法完成全部的工作，我们共同的付出会带来更美好的世界。




 
