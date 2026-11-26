# 双店铺并行：现状、边界与实施计划

> 状态：用户于 2026-10-22 确认两个店铺分别登录不同 Chrome profile，采用路径 A；部署说明已补齐，实机双实例与真实发送未验收。任务状态见 `docs/tasks/2026-10-22-multi-store-profiles.md`。

## 结论

当前扩展只能安全管理“一份页面会话 + 一个未结束任务”。真正的双店铺并行有两个可行层级：

1. **推荐且最小：两个 Chrome profile 各运行一份虾仁。** Chrome 的站点 cookie、扩展存储和 MV3 后台按 profile 隔离，两份实例天然各有一个 workspace、一个队列和一套历史。无需改共享后台，只需要分别加载扩展并分别授权、分别运维。
2. **同 profile 多 workspace：仅在两份 Shopee 会话能被页面证据证明互不影响时实施。** 需要把单 `workspace`、单 `task`、单 `preview` 和单标签页路由改为显式 workspace 会话；不能只开两个标签页。

在两份独立登录会话尚未确认前，不应当通过并行改造放宽店铺、文档、页面会话或收件人核对。

## 已确认的当前流程

### 状态与持久化

- `extension/core/queue.mjs:5` 的根状态是 `{ task, history, denied }`，只有一个未结束任务。
- `extension/core/queue.mjs:187` 在已有未完成任务时拒绝启动新任务。
- `extension/core/backend.mjs:104` 的闭包只保存一个 `state`、一个 `workspace` 和一个 `preview`。
- `extension/core/backend.mjs:193` 只读取 `creatorQueue` 与 `creatorWorkspace`。
- `extension/core/backend.mjs:212` 每次保存都把同一份单任务状态和单 workspace 写回旧键。
- `creatorQueue.history` 和 `creatorQueue.denied` 已经按 `shopId` 分区，但 `task` 仍是全局单值。

### 页面与会话绑定

- `extension/core/backend.mjs:310` 只允许来自 `workspace.tabId`、`workspace.documentId` 的顶层页面消息。
- `extension/core/backend.mjs:319` 的名单绑定只包含一个 `tabId`、`documentId` 和 `pageId`。
- `extension/core/backend.mjs:558` 的工作台操作全部作用于唯一 workspace。
- `extension/core/backend.mjs:693` 的 hello 只能绑定唯一页面。
- `extension/core/backend.mjs:918` 与 `extension/core/backend.mjs:956` 只跟踪唯一专用标签页。
- `extension/content.js` 本身是逐页实例，但后台当前只承认一个页面。

### 店铺身份与发送保护

- `extension/page-snapshot.mjs:35` 从当前登录页面根 store 读取店铺 ID 与名称。
- `extension/core/page-guards.mjs:2` 要求可信印尼卖家站和已识别店铺。
- `extension/core/page-guards.mjs:8` 与 `extension/core/page-guards.mjs:21` 在授权前核对店铺、收件人、草稿和图片会话。
- `extension/page-snapshot.mjs:246` 在最终点击的同一同步操作内再次核对来源、店铺、收件人、文档、名单和草稿。
- `extension/core/queue.mjs:123` 的任务事件必须同时匹配会话、标签页、页面和店铺。
- `extension/core/backend.mjs:859` 在最终点击前先持久化单次声明，结果不明则不重试。

这些保护不能为了支持并行而删除或放宽。

### 历史、模板与图片

- `creatorTaskHistory` 已保存每次任务的店铺快照，但历史查询只合并一个当前任务。
- `extension/core/task-history.mjs:80` 的 `mergedTasks` 只接受单个 `currentTask`。
- `extension/core/backend.mjs:286` 读取历史时也只提供一个当前任务。
- 消息模板保存在全局 `creatorMessageTemplates`，没有店铺字段。
- 图片资产保存在全局 `creatorImageAssets`，按内容摘要去重，没有店铺字段。
- 模板和图片写入由全局后台串行保护；真正发送时仍按任务中的资产引用重新核对。

### 浏览器登录证据

- 本机存在多个本地 Chrome profile，但本次未读取 cookie、密码、token 或页面正文。
- 项目现有说明明确写着切换账号会使旧准备失效、旧任务不能在另一店铺恢复。
- 当前代码从标签页内当前店铺根 store 读取身份，不证明两个标签会获得两份独立账号 cookie。
- 同一 origin 的普通 cookie 由 Chrome profile 共享；两个标签默认不是两份独立登录会话。

因此，“两个标签页”不能被当成“两份账号会话”。

## 根因层级

根因不在点击器或名单筛选，而在四个上层：

1. **会话层**：同一 Chrome profile 的同一站点登录通常只有一份 cookie 会话，页面标签不能天然隔离账号。
2. **持久化层**：只有一个 `task` 和一个 `workspace`，第二份状态会覆盖或阻塞第一份。
3. **路由层**：所有页面消息按唯一 `tabId` 验证，所有工作台消息没有 workspace 选择器。
4. **展示层**：工作台只轮询一个 `{state, workspace}`，只能显示一个队列。

历史与拒绝名单已有店铺键，但不是完整的并行状态模型。

## 路径 A：不同 Chrome profile，各运行一份虾仁（建议）

### 行为

- 每个 profile 各自加载同一份 `extension/`。
- 每个 profile 各有一个工作台、一个专用 Shopee 标签页、一个队列。
- 两个队列独立准备、启动、暂停、继续和结束。
- 一个 profile 的标签页事件、存储和历史不会影响另一个 profile。
- 每个 profile 的真实发送仍需单独授权。

### 改动

- 核心状态机不需要改成多 workspace。
- 保留现有“切换账号会暂停旧任务”的保护。
- 增加部署与非发送验收说明，明确必须分别安装、分别登录、分别核对店铺。
- 若后续需要统一查看两个 profile 的历史，必须另建本地外部汇总器；MV3 扩展不能在未获原生消息权限的情况下直接跨 profile 读写。

### 副作用与限制

- 用户需要同时管理两个 Chrome 窗口或 profile。
- 两个 profile 的模板、图片、历史默认不共享。
- 不能在一个工作台里统一下发两份发送；这是浏览器隔离的直接结果。
- 现有代码不需要迁移，旧存储继续按原样读取。

### 验证

1. 两个 profile 分别加载扩展，确认各自工作台可打开。
2. 两个 profile 各自打开专用页并登录不同店铺。
3. 只做非发送核对：分别准备名单，确认店铺、名单、来源、文档和标签页互不串线。
4. 在 A 暂停或结束任务，确认 B 的队列状态不变。
5. 在 A 切换账号或导航，确认 B 的任务仍可由 B 自己控制。
6. 不执行真实发送；真实发送需另行指定达人、授权和验收窗口。

## 路径 B：同一 profile 内多 workspace

此路径只有在页面证据证明两个店铺能够在同一 profile 内保持两份独立登录上下文后才可实施。若实际是同一账号切换店铺，而切换会改变共享登录上下文，则应回到路径 A。

### 目标状态模型

建议新增一个带版本的会话根，例如：

```text
creatorStoreSessions = {
  version: 1,
  revision,
  workspaces: {
    [workspaceId]: {
      id,
      browserSessionId,
      workspace: { tabId, pageId, documentId, documentEpoch, shop, collection, preparation, ... },
      task,
      preview
    }
  }
}
```

`history` 与 `denied` 可以继续作为按 `shopId` 分区的全局边界，但每个 workspace 的 `task`、页面绑定、名单准备和队列控制必须分开保存。两个 workspace 不得同时绑定同一个已识别店铺。

### 路由要求

- 工作台请求必须携带 `workspaceId`；没有明确 workspace 的请求拒绝。
- 页面请求先按 `sender.tab.id` 找到唯一 workspace，再核对 `pageId`、`documentId`、`documentEpoch` 和 `shopId`。
- `onUpdated` 与 `onRemoved` 只影响对应标签页的 workspace。
- 页面 hello、轮询、准备、授权、提交和结果回包都保留原会话身份，不能仅凭标签页是“已知专用页”就接受。
- 任务 binding 增加 `workspaceId`，并在 pure queue 的事件匹配中校验。

### 并发要求

- 两个队列可以独立准备和启动。
- 允许后台保留一个短临界区串行化对存储的原子提交，但不得让一个 workspace 的未完成页面会话篡改另一个 workspace。
- 页面动作仍然逐条、单次、先落盘后点击。
- 一个 workspace 出现 `uncertain` 时只暂停它自己；另一个 workspace 不受影响。
- 浏览器重启后所有活动任务都进入暂停，不自动恢复发送。

### 工作台要求

- 最小安全 UI 是两个独立工作台标签页，每个固定绑定一个 `workspaceId`；这样不必用一个页面同时渲染两个队列。
- 任一工作台只能通过显式 ID 查看和操作自己的 workspace。
- 切换页面时必须重新核对专用页、店铺、文档和锁定名单。
- 历史页可以继续跨店铺展示，但必须带店铺标签并按 `shopId` 过滤；当前任务应合并所有 workspace 的快照后再按 ID 去重。

### 模板与图片

- 模板和图片已是无店铺内容资产，第一阶段建议保持全局共享，避免额外迁移。
- 模板和图片写入仍使用现有 revision 与全局串行保护。
- 任务启动时继续逐个核对图片引用、摘要、尺寸和会话。
- 如果用户要求“A 店铺不可见 B 店铺的模板或图片”，再单独为模板和图片增加店铺作用域；不要把它混进本轮页面并行改造。

### 持久化兼容与迁移

1. 读取顺序：先读新会话根；不存在时才读取旧 `creatorQueue` 和 `creatorWorkspace`。
2. 旧数据迁移为一个 workspace，旧任务、历史、拒绝名单和当前名单保持原值。
3. 迁移前写入可恢复备份键，保存旧 `creatorQueue`、旧 `creatorWorkspace`、迁移时间和格式版本。
4. 旧键不删除、不清空；新旧键不会同时作为业务权威写入。
5. 新会话根成功落盘后才启用多 workspace；任何备份或写入失败都停止迁移，继续保留旧数据。
6. `creatorTaskHistory` 不重写、不自动清理；只扩展读取函数以合并多个当前任务。
7. 迁移过程不打开页面、不注入脚本、不恢复任务、不发送。

### 验证设计

1. 旧存储单任务可读；迁移后旧键仍在，备份存在，任务未被重置。
2. 两个 workspace 可分别准备名单；A 的准备不会清除 B 的准备。
3. A 启动、暂停、继续、结束均不影响 B。
4. A 的标签页更新、关闭、hello 和延时回包不能改变 B 的状态。
5. A 的页面身份变为 B 的店铺时，只有 A 暂停；B 的保存、草稿和任务保持原样。
6. 跨 workspace 的 previewToken、taskId、sessionId、itemId、messageIndex 和 tabId 组合被拒绝。
7. A 的结果不明只让 A 进入人工核对；B 继续但不自动重试 A。
8. 两个当前任务和归档任务在历史页按店铺正确显示，不重复、不串店。
9. 模板和图片并发写入不丢失 revision；缺失图片阻止对应任务。
10. 浏览器重启后两个活动任务都暂停，均需人工恢复。
11. 迁移写入失败、备份失败、存储配额不足时，旧数据和旧页面不动。
12. 全部执行只使用本地夹具和非发送页面检查；不声明真实发送、真实发图或平台送达。

## 最小实施顺序

1. 用户确认两个店铺的浏览器登录隔离形态。
2. 若为两个 profile：采用路径 A，补充部署说明和非发送双实例验收；不修改共享后台。
3. 若为同 profile 且有两份独立会话证据：先写迁移与会话模型的失败测试，再改 `core/backend.mjs`、`core/queue.mjs`、工作台和历史读取。
4. 每改共享后台前重读需求2对话与最新文件，不覆盖其导航焦点改动。
5. 运行正式 Node 行为测试、静态检查和非发送页面回归。

## 已解除的阻塞

用户于 2026-10-22 在接管聊天确认：两个店铺分别登录不同 Chrome profile。因此采用路径 A，不实施路径 B 的存储迁移或多 workspace 改造。部署与非发送验收见 [双店铺操作说明](../../multi-store-profiles.md)。
