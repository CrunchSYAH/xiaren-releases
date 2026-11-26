# 目标人数收集：UI 集成契约

目标数模式已经接入 backend / queue / snapshot / content；dashboard.* 由主对话集成。原手选模式的 panel:preview → panel:start 保留；界面可以在用户点击启动时内部自动执行这两步，无须展示“生成逐人预览”按钮。

主对话已完成工作台接入：默认人数100，先准备名单，ready后才可启动；界面只走严格人数流程，不提供手选绕过。10人分页与实时内容预览保留。最终提交已额外带原observed前缀及目标行，在MAIN同步核对后才点击，弥补持久化等待期间列表变化的边界。本地测试插件按用户最新指令搁置，不继续转换夹具或进行该插件验收。

## UI 消息

- 准备名单：`{type:'panel:collect', targetCount:100}`。只接受 1–200 正整数；须已连接专用达人页、没有未完成任务。返回 `{state,workspace}`，不会创建发送任务、填草稿或点击聊天。
- 查看进度：原 `{type:'panel:get'}`；读取 `workspace.collection`。页面 content 每秒 poll，逐次领取短收集指令，后台不占用长循环。
- 取消准备：`{type:'panel:cancel-collection'}`。返回同上；取消后不可恢复旧名单，须重新准备。收集中原 `panel:pause` / `panel:stop` 也会取消准备。
- 启动前自动校验：`{type:'panel:preview',config}` → `{type:'panel:start',config,previewToken,confirmed}`。真实模式仍必须由用户明确确认 `confirmed:true`，演练不要求该字段。

目标模式 `config`：

```js
{
  shop: workspace.shop,
  creators: workspace.collection.creators.map(({id,name}) => ({id,name})),
  targetCount: workspace.collection.target,
  collectionId: workspace.collection.id,
  limit: workspace.collection.target,
  template, intervalSeconds, mode // 原格式，mode = 'dry-run' | 'send'
}
```

目标模式不允许改人、改顺序、减少 limit，或删除 collectionId 走手选路径。后端两次独立检查当前 DOM 名单、店铺/原文档/页面会话、历史/拒绝记录和配置签名；少一个人也不能启动。模板、间隔、模式可修改，点击启动时自动重新 preview 即可。

## 可用返回字段

`workspace.collection` 为空表示从未准备。非空时包含：

- `id,target,status,count,shortfall,reason`：收集 ID、目标、状态、实际备齐数、缺额、面向用户的原因。
- `creators:[{id,name,rowKey,chatAvailable}]`：按页面顺序筛出的锁定候选；只有 ready 可启动。UI 展示/渲染用该名单，不要误用仍为前200条的 `workspace.creators`；前200条仍服务原手选模式。
- `binding:{browserSessionId,tabId,documentId,documentEpoch,pageId,shopId}`：后台核对的绑定，只读；`observed` 是后台检测列表替换的身份锚点，UI无需展示。
- `startedAt,progressAt,updatedAt,action`：内部时序和一次性动作；UI不要生成或回传 action。

状态：`collecting` 正在收集 → `ready` 已按目标备齐并锁定 → `consumed` 名单已进入任务；也可能进入 `insufficient`（不足、加载无法识别或停滞）、`cancelled`（用户取消）、`invalid`（绑定或原列表变化）。后三者都不能启动，只能重新准备。ready 后导航、刷新名单、切账号、原行替换/重排/入口变化、锁定达人被拒绝均会失效；取消也销毁启动资格。

界面建议：collecting 显示“已准备 count / target，仍缺 shortfall”；insufficient 显示 reason 并禁用启动。ready 后显示“已锁定 target 人”；10人一页仅对展示切片，分页不修改 collection.creators，不允许把当前显示页当作提交名单。实时消息展示直接由模板和完整名单计算，不持有 previewToken；仅点击启动时领取临时 token。

## 需由集成方同步的文件

主对话已将 **core/collection.mjs** 加入本地生成包，并加入相对导入依赖闭合回归；构建/预览脚本仍不在本对话修改范围。backend 的 `MARKETPLACE_PATH` 从入口 MARKETPLACE 自动取得，因此生成包入口转换后会自动跟随；`page-snapshot.mjs` 的列表动作仍需由本地构建脚本转换其生产路径 `/portal/web-seller-affiliate/kol_marketplace`，本地100人夹具入口为 `/tests/fixtures/target-count.html`。正式 extension 不添加 localhost 开关或权限；新夹具与 recorded 样本分离。

## 安全语义与验证边界

- 只支持已观察到的追加式无限滚动；不调用私有接口/加载回调，不用组件缓存名单作收件人。每位达人必须有当前挂载 DOM 行和聊天入口；分页替换/虚拟列表替换会使名单失效，不能盲点不可见对象。
- 最多扫描5000个已挂载行；目标仍最多200人。45秒无新增 DOM 或10分钟准备超时会停止并显示差额。已有任务、持久化失败阻断新收集/启动，动作令牌保存消费后才滚动。
- 备齐是“依本工具历史没有发送或待核对记录、未拒绝且有聊天入口”，不承诺平台成功送达。启动后遇错仍暂停，不补人、不以凑满成功人数自动重试；聊天水位缺失仍禁止真实发送。
- 同文档 URL 导航事件也会销毁目标名单并暂停旧任务；后台读取和 MAIN 最终点击检查达人路由。最终点击的最低消息水位使用提交前最近读取值，拒绝授权后或同步点击前的水位回退，不能把历史回执误算成新发送成功。
- 真实平台尚未验证发送与回执；开发期间没有填入真实草稿、点击真实聊天入口或发送按钮。

## 真实加载观察（2026-10-16）

在单独新建的 Shopee 达人页观察：首批12行、没有分页；滚动后 DOM 依次为24、36、48、72、84、96、108行，首行索引始终0，末行为总数减1，旧行保留。最后确认108个不同身份、首末索引0/107、没有打开聊天。`.kol-card-layout-global` 的父组件实际公开白名单 `list` 数量、`hasMore:boolean`、`loading:boolean`；`.kol-loading-more` 是真实 Loading ... 哨兵。使用本次 inspectPage 源码，只读取这些 flag 并执行受身份/文档/名单指纹保护的 scrollIntoView，已观察84→96→108追加；未调用加载回调或私有接口。自建真实页已关闭，原用户页面未操作。

未导出或保存真实达人身份/消息/凭证；新增100人夹具明确为虚构，不能代表真实100次发送成功。
