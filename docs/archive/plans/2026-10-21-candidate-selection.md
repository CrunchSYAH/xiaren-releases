# 候选缓冲与名单勾选实施计划

> 用于本对话执行；用户已确认规则。按 TDD 先写失败测试，再实现。不提交、不推送、不创建分支。

**Goal：** 目标 N 人时准备最多 `min(200, N + ceil(N × 10%))` 名候选，默认选中页面顺序前 N 人，允许用户换选，但只能以恰好 N 名已选达人启动。

**Architecture：** `workspace.collection` 同时保存候选目标、候选池和稳定的 `selectedIds`。收集完成由候选池是否达到候选目标决定；任务启动由已选数量是否恰好等于 `target` 决定。队列继续只接收已选 N 人，页面最终 MAIN 核对仍使用完整候选锚点。

**Tech Stack：** 原生 ES modules、Chrome MV3、Node.js `node:test`、现有工作台 DOM/行为测试。

## Global Constraints

- 不提交、不推送、不创建分支，不改写 Git 历史。
- 不发送真实消息、不打开真实聊天、不生成或修复本地测试插件。
- 指定 Shopee 用户 ID、指定联盟伙伴和达人库选择不增加候选缓冲。
- 候选目标 `min(200, N + ceil(N × 0.1))`；发送目标仍为 N。
- 必须恰好选中 N 人才可以预览和启动；工具不得自动减少 N 或静默替换已选人员。
- 默认选中候选页面顺序前 N 人；补足优先从从未进入默认前 N 的候选中按页面顺序选择。
- 来源、筛选、店铺、文档或原页面锚点变化时旧集合失效；显式追加候选保留原选择并撤销发送确认。
- 未选候选不得进入任务、发送历史或最终点击的新增权限。

## 文件边界

- `extension/core/collection.mjs`：候选目标、候选池、默认选择、换选和补足。
- `extension/core/backend.mjs`：选择/补足消息、能力声明、预览和启动校验。
- `extension/dashboard.html`、`dashboard.mjs`、`dashboard.css`：可勾选名单、计数、补足操作和确认撤销。
- `extension/core/queue.mjs`：继续只接受已选 N 人的配置，原则不改。
- `extension/page-snapshot.mjs`、`content.js`：不改最终点击协议。
- `tests/collection.test.mjs`、`tests/target-backend.test.mjs`、`tests/dashboard.test.mjs`：新增行为回归。

## Task 1：候选池与默认选择

**Files：**
- Modify：`extension/core/collection.mjs`
- Test：`tests/collection.test.mjs`

**Interfaces：**
- Produces：`candidateTarget`、`candidateCount`、`selectedIds`、`selectedCount`、`selectionRemaining`、`candidates`、`excludedIds`、`selectionRevision`。
- Produces：`selectCandidate(collection, creatorId, selected)`、`refillSelection(collection)`。

- [x] 写测试：100 人目标准备 110 名候选，默认选择前 100 人。
- [x] 写测试：取消第 1–10 人后为 90/100，补足从 101–110 补回，不选刚取消的人。
- [x] 写测试：取消 11 人后只能补到 99/100，并给出明确原因。
- [x] 写测试：已选 100 人时新增勾选被拒绝；取消后可以替换。
- [x] 写测试：N=181/182/200 时候选目标分别为 200/200/200。
- [x] 写测试：候选池耗尽但人数不少于 N 时仍可完成并显示缓冲不足。
- [x] 运行聚焦测试确认失败。
- [x] 实现最小状态和选择函数。
- [x] 运行聚焦测试确认通过。

## Task 2：后台选择与启动校验

**Files：**
- Modify：`extension/core/backend.mjs`
- Test：`tests/target-backend.test.mjs`

**Interfaces：**
- Produces：`panel:select` `{collectionId, expectedRevision, creatorId, selected}`。
- Produces：`panel:refill-selection` `{collectionId, expectedRevision}`。
- Produces：能力 `candidateSelection: true`。
- Changes：`checkConfig` 校验 `config.creators` 精确等于 `collection.selectedIds` 对应的 N 人。

- [x] 写测试：工作台来源可以换人，未结束任务和已消费名单不能修改选择。
- [x] 写测试：未选候选人不会进入 `panel:preview` 生成的任务。
- [x] 写测试：已选候选人被拒绝或出现历史记录时必须重新补足，不能少发。
- [x] 写测试：候选池中未选人员变化不会错误地进入发送名单。
- [x] 运行聚焦测试确认失败。
- [x] 实现选择持久化、映射校验和消息能力。
- [x] 运行聚焦测试确认通过。

## Task 3：工作台勾选与补足

**Files：**
- Modify：`extension/dashboard.html`
- Modify：`extension/dashboard.mjs`
- Modify：`extension/dashboard.css`
- Test：`tests/dashboard.test.mjs`

**Interfaces：**
- Consumes：`panel:select`、`panel:refill-selection`、`candidateSelection` 能力。
- Produces：候选计数、已选计数、剩余人数、补足按钮和复选框状态。

- [x] 写测试：ready 后复选框可操作，默认状态来自服务端选择而非页面本地猜测。
- [x] 写测试：取消勾选后发送确认被撤销，开始按钮禁用并显示还差人数。
- [x] 写测试：补足按钮按服务端返回恢复 N 人；备选耗尽时明确提示。
- [x] 写测试：跨页勾选状态稳定；任务启动后复选框禁用。
- [x] 写测试：换选异步迟到响应不能覆盖新状态或旧店铺。
- [x] 运行聚焦测试确认失败。
- [x] 实现最小 UI、消息接线和状态文案。
- [x] 运行聚焦测试确认通过。

## Task 4：验证与文档

**Files：**
- Modify：`README.md`
- Modify：`AGENTS.md`
- Create：`docs/verification-2026-10-21-candidate-selection.md`

- [x] 更新 README 使用流程、候选数公式、换选与补足规则。
- [x] 更新 AGENTS 的当前实现事实和验证边界。
- [x] 运行聚焦测试。
- [x] 运行全部允许的正式 Node 测试（排除 `local-build.test.mjs` 并跳过 launcher 动态检查）。
- [x] 运行 `node scripts/check.mjs`。
- [x] 重新读取改动文件，记录未做的发送/发图/已安装扩展人工验收。
