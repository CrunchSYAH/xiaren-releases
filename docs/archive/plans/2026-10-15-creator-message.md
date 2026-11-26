# 印尼达人自动私信第一版实施计划

> **For agentic workers:** Use subagent-driven-development for isolated queue implementation and independent review. 本项目以用户 AGENTS.md 为准：不提交、不创建分支，所有改动保留工作区；以文件快照审阅替代提交区间审阅。

**Goal:** 实现独立、本地、仅印尼站的 Chrome 扩展，从可见达人名单运行可暂停的自动队列。

**Architecture:** 无构建步骤的 Manifest V3 扩展。持久化纯状态机负责队列，后台串行处理事件和保存；页面适配器只在工具新建的标签页执行，操作面板提供选择、预览、演练、发送和结果核对。页面通过请求下一步唤醒后台，不依赖后台常驻。

**Tech Stack:** 原生 JavaScript ES modules、Chrome extensions API、Node.js 24 内置测试；不使用外部运行依赖或 CDN。

## Global Constraints

- 只允许 `https://seller.shopee.co.id/*` 网站权限；不读取、保存或输出凭证。
- 真实发送未经授权，不点击任何真实发送按钮；允许本地模拟与自建标签页页面检查。
- 不修改原安装扩展及用户原有标签页，不提交、不创建分支，不改写历史。
- 异常、身份不明、发送结果不明时暂停；后者不能自动重试，后台普通休眠可在会话核对后继续。
- 用户明确启动才能运行；默认演练模式，真实模式必须重新预览并明确选择。

## 文件与接口

- `extension/core/queue.mjs`：可序列化状态机；`initialState()`、`previewTask(state, config)`、`reduceQueue(state, event, {now, uid}) => {state, command}`。
- `extension/background.mjs`：chrome.storage.local 持久化、事件互斥、专用标签页与会话绑定、消息校验。
- `extension/content.js`：隔离世界页面适配器，读取当前页面、核对身份、一次性执行指令与结果采样。
- `extension/dashboard.html`、`dashboard.mjs`、`dashboard.css`：中文操作面板，不使用远程字体或资源。
- `extension/manifest.json`：storage、scripting 权限及印尼站权限。
- `tests/queue.test.mjs`、`tests/content.test.mjs tests/guards.test.mjs tests/snapshot.test.mjs`、`tests/backend.test.mjs`：关键风险验证；`scripts/check.mjs` 语法与 manifest 检查。
- `tests/fixtures/marketplace.html`：完全虚构的达人及店铺，本地演练与 UI 检查。
- `README.md`：加载方式、操作流程、验证范围和已知限制。

### Task 1: 队列状态机

**Files:** `extension/core/queue.mjs`、`tests/queue.test.mjs`。

**Interfaces:** config 包含 `shop:{id,name}`、`creators:[{id,name}]`、`template`、`intervalSeconds`、`limit`、`mode:'dry-run'|'send'`。状态包含 version、task、history、denied；任务包含 id、sessionId、binding、status、items、nextAt。绑定为 `{tabId,pageId}`。事件接口详见 `.superpowers/sdd/task-1-brief.md`。

- [x] 先写测试，证明空模板、稳定标识缺失、重复名单、拒绝名单和跨店铺历史的行为。
- [x] 运行 `node --test tests/queue.test.mjs` 确认失败，再实现校验和预览。
- [x] 测试并实现单任务串行派发、持久化发送意图、单次授权、结果不明暂停、人工核对。
- [x] 测试并实现双启动、旧会话回报、暂停竞态、间隔不追赶、演练不写发送历史及恢复限制。
- [x] 自审并记录 RED/GREEN 证据；独立审阅发现必须修复的问题后重验。

测试形态：`assert.equal(reduceQueue(state, {type:'poll', ...context}, {now,uid}).command, null)`，在暂停或时间未到时不得获得发送指令。

### Task 2: 页面适配与后台桥接

**Files:** `extension/content.js`、`extension/background.mjs`、`extension/manifest.json`、`tests/content.test.mjs tests/guards.test.mjs tests/snapshot.test.mjs`、`tests/backend.test.mjs`、`tests/fixtures/marketplace.html`。

- [x] 在自建 Shopee 标签页检查真实 DOM 的列表、身份和聊天入口；只输出非凭证结构，不读取会话存储。
- [x] 先写本地适配器失败用例，覆盖身份不明、目标不符、缺少控件和清空输入框不代表成功。
- [x] 实现页面适配；每次 prepare/authorize/send 都复核目标，观察新出现的发出消息及失败状态；不采用脆弱的全页同名文本匹配。
- [x] 后台仅接受扩展面板或已绑定专用页面的消息。所有状态变化进入同一串行 Promise，保存成功后才回传指令。
- [x] 页面每秒请求下一步；已派发指令不再派发，页面重载生成新 pageId 并暂停旧任务；后台重启读存储核对会话。
- [x] 测试页关闭、存储失败、重复授权、未绑定标签页和外域消息；运行 `node --test tests/content.test.mjs tests/guards.test.mjs tests/snapshot.test.mjs tests/backend.test.mjs`。

### Task 3: 操作面板与安装包

**Files:** `extension/dashboard.html`、`extension/dashboard.mjs`、`extension/dashboard.css`、`scripts/check.mjs`、`package.json`、`README.md`。

- [x] 实现连接专用达人页面、读取列表、勾选名单、模板、间隔和任务上限。
- [x] 实现预览后启动，配置变化使预览失效；拒绝名单与待核对记录能在界面操作。
- [x] 实现进度、暂停/停止/恢复、错误原因、导出 JSON 结果，演练和真实记录区分。
- [x] 视觉采用浅灰工作台、深蓝导航和 Shopee 橙色主操作；左侧设置，中间达人列表，右侧消息预览和队列；不加入营销装饰。
- [x] 提供无构建加载说明、实际检查命令和真实发送未验证的说明；安装包只打包 extension 内容。

### Task 4: 集成验收与复审

- [x] 运行 `node --test`、`node scripts/check.mjs`，对异常场景作聚焦验证。
- [x] 通过本地虚构页面验证完整演练及模拟发送队列，检查面板实际渲染、空态和操作状态。
- [x] 复审主链路、状态、权限、恢复、事件来源、拒绝名单和结果证据；修复后只重跑相关检查及最终全套一次。
- [x] 关闭自己创建的检查标签页；输出加载路径、验证证据、实际页面适配限制和真实发送尚未验证的边界。
