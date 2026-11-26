# 本地达人库交接

status: ready

## 所有权与设计

仅新增 creator-library 命名的纯模块、独立接口处理模块、测试及 extension/creator-library.html/js/css；不改共享业务文件。本地测试插件继续暂停。

独立 creatorLibrary 存储，最多 2000 条且 JSON UTF-8 2 MiB。站点固定 ID，店铺显式保存；按站点、店铺、身份类型、身份值去重，未知身份不按姓名猜测。手工添加／导入一律待页面核实；联盟伙伴 ID 不转换成 Shopee 用户 ID。全库 revision 乐观锁，后台独立串行写入，损坏或未知版本拒绝读写并保留原值。

独立页面提供添加、JSON/CSV 导入、查询筛选、标签备注、选择与 JSON/CSV 导出。选择交接仅包含数字 Shopee 用户 ID 且同一站点／店铺的记录；工作台必须显式套用并重新通过页面准备，不得直接发起任务或越过 collection 核对。

## 接口

独立模块、页面与测试完成；以下接口可供集成对话接入：

- `core/creator-library-handler.mjs` 导出 `isCreatorLibraryMessage(message)` 与 `createCreatorLibraryHandler(api, {now, uid})`。后台创建一次 handler；在业务 enqueue / initialize 前 `if (isCreatorLibraryMessage(message)) return library.handle(message, sender)`，由现有外层统一包装 `{ok:true,...}` / 错误。不要放进会记日志的业务链。
- 消息：`panel:library-list {filters?}`、`panel:library-add {draft,expectedRevision}`、`panel:library-update {recordId,draft,expectedRevision}`、`panel:library-import {records 或 content+format,expectedRevision}`、`panel:library-export {format:'json'|'csv',filters?}`、`panel:library-select {recordIds,expectedRevision,site:'ID',shopId}`。
- 响应分别为 `creatorLibrary`、写入附 `savedRecordId`／导入 `added,skipped`、`creatorLibraryExport`、`creatorLibrarySelection`。handler 不返回 `ok`，失败抛固定中文错误。只允许精确 dashboard.html 和 creator-library.html URL、同扩展 ID、顶层 frame。
- **当前入口（2026-10-21 修复）：在当前标签页往返。** 点击前将消息、图片引用及表单草稿保存到 `sessionStorage.creatorDashboardDraft`，并写入 `creatorLibraryContext {site:'ID',shopId:workspace.shop.id}`，再跳到 `creator-library.html`。图片读取或暂存失败时留在工作台并显示原因；context 只供筛选，不当作页面核实。
- 库页读取后删除 context；选择后仅把精简名单写入同标签页的 `sessionStorage.creatorLibrarySelection` 并跳回 `dashboard.html`，不再使用新窗口及 opener 通信。
- 工作台初始化读取后移除 draft 和 selection 键，恢复草稿并撤销发送确认，仅显示待套用名单；图片原件从独立资产库重新读取。未结束任务仍以后台保存的配置为准，不能用暂存草稿覆盖。
- 显式套用时再次 `panel:library-select` 传 records 中的 id、libraryRevision、当前真正的 shopId，检查响应 scope 与当前 shop 相等，失效则拒绝。保留当前消息配置，只更新名单来源与目标人数并撤销旧 collection/预览/发送确认；走正常页面准备。若当前任务未结束，先阻止套用，不能自动结束／恢复任务。
- 选择数据 `{version:1,kind:'creator-library-selection',libraryRevision,site,shopId,creatorIds,records,requiresPageVerification:true}`，`creatorIds` 是已保存的 Shopee 用户 ID（手工填写仍为待核实，绝非聊天可达声明），按点选顺序去重。库中无可信用户映射的 affiliate_id / unknown 选择会报错。接入方若指定伙伴模块有真实映射，之后才能通过可信纯入口更新。
- `verifyCreatorLibraryRecord` 是纯可信集成入口，未暴露 runtime 消息；只能用真实页面核实后的 evidence 调用，不能把 UI/导入数据或数字相等当证据。本次不自动生成 page_verified。

### 纯模块导出与数据

`core/creator-library.mjs` 无 Chrome、网络、队列依赖。导出：

- 常量 `CREATOR_LIBRARY_KEY`（creatorLibrary）、`CREATOR_LIBRARY_LIMIT`（2000）、`CREATOR_LIBRARY_MAX_BYTES`（2097152）。
- `emptyCreatorLibrary()`、`readCreatorLibrary(value)`、`listCreatorLibrary(store,filters?)`；list 返回 `{version,revision,records,capacity,shops,tags}`。filters 支持 `query,shopId,site,tag,identityType,verification`；shops/tags来自全库，不限当前筛选。
- `createCreatorLibraryRecord(store,draft,{id,now,expectedRevision})`、`updateCreatorLibraryRecord(store,{recordId,draft,expectedRevision},{now})`，返回新库；不变更原对象。expectedRevision 是全库 revision，记录 revision 仅用于显示最近改动的库版本。
- `importCreatorLibraryRecords(store,drafts,{now,expectedRevision,uid})` 返回 `{store,added,skipped}`；`parseCreatorLibraryImport(content,'json'|'csv')` 返回草稿数组；`exportCreatorLibrary(store,{format,filters?})` 返回 `{format,content,mime,count,revision}`。文件输入最多4MiB，以容纳格式化导出；最终库仍不超过2MiB，导入原子成功或失败。
- `selectCreatorLibrary(store,{recordIds,expectedRevision,site,shopId})`、`verifyCreatorLibraryRecord(store,{recordId,expectedRevision,evidence},{now})`。可信 evidence 必须精确包含 `site,shopId,identityType,identityValue,shopeeUserId`；当前纯入口未与页面证据链相连，调用方将来若接入，须与此 handler 的写入串行化，不能在旁路直接 read-modify-write。

draft 白名单：`{name,identityType:'shopee_user_id'|'affiliate_id'|'unknown',identityValue:string,site:'ID',shopId:string,source:{kind:'manual'|'import'|'marketplace'|'leaderboard'|'specified',label},tags:string[],note}`。name可空最多120字符，未知身份值1—100字符，数字身份1—30位且非零开头；shopId可空最多100字符，空店铺记录不可选；source.label最多120字符；最多20个标签、各1—30字符；note最多1000字符并允许换行。未提供source时按新增manual／导入import保存。

库结构 `{version:1,revision,records}`；记录补 `{id,shopeeUserId:string|null,verification:{status:'unverified'|'page_verified',checkedAt:number|null},revision,createdAt,updatedAt}`。手填用户ID只代表所填数字，依旧unverified；伙伴ID和未知身份初始 shopeeUserId 为 null。更改站点、店铺、身份类型或值撤销原核实映射；改备注／标签不影响。导入不信任外部verification和shopeeUserId，重复身份保留原记录不合并，全部重复不写盘／不增加revision。不存在自动删除、清空、自动淘汰接口。

### 接入步骤

1. 共享 backend 创建单例 handler，`handle` 最前分流（在 initialize、队列串行日志链、faulted判断前）；库错误不能传给业务 `operation:error`，也不能设置业务 faulted。
2. dashboard 在保存当前草稿及 shop context 后同页进入库；返回后消费同标签页的草稿和精简选择，只形成待套用状态。
3. 显式套用时复调 library-select；核对当前店铺、全库版本、身份数组与未结束任务保护。保留消息／图片草稿；使旧名单、发送确认和预览失效；将 creatorIds 交到正常来源／准备链，不将库记录作为 collection 或直接聊天身份。当前旧 `specified` 只是已挂载名单筛选，不能把它包装成真正伙伴解析；由集成方结合指定伙伴报告选择正确来源。
4. 集成方补后台早分流隔离测试、工作台接收／显式套用／店铺变化／消息草稿保留测试，之后跑全部正式测试（排除local-build）。

## 验证

- `node --test tests/creator-library*.test.mjs`：22/22 通过（2026-10-20）。覆盖来源权限、独立读写、并发冲突、损坏不覆盖、容量、批量原子导入、CSV公式／超长数字／单引号防护、身份类型、映射撤销、无损标签、草稿保留、旧响应隔离与名单交接。
- `node scripts/check.mjs`：32个文件语法、3段夹具脚本、Manifest与无外部请求检查通过。命令内部只在内存构造本地测试版以查语法；未生成、安装、运行或修复本地测试插件。
- 独立无头 Chrome 对本地HTML+CSS+JS及合成数据检查：1500px桌面宽度与390px窄屏，documentWidth等于viewport；表格自身720px横向滚动区域正常，运行无pageerror。已人工查看两张截图；浏览器由本次创建并已关闭，未访问外站／既有页面／真实数据。
- 独立只读复核已完成；发现的逗号／数组样式标签编辑副作用均已补失败回归后修复，最终复核无其他实质问题。

## 边界与尚未验证

本页是本机数据整理工具，无厂商云端数据。未访问Shopee页面、未采集真实身份、未上传附件、未真实发送；实际发送与伙伴解析事实由各自对话报告为准。后端分流、工作台入口／接收与真实 collection 集成由共享文件所有者完成，本对话没有修改共享 backend/dashboard/queue/manifest/AGENTS/README。接口测试使用 Chrome API 替身，布局检查使用合成数据，不等同于已安装扩展或真实平台验收。
