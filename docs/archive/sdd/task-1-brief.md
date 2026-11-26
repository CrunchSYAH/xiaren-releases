# Task 1: 纯队列状态机

预期输出：一个经行为测试验证的纯状态机，确保单次发送授权、跨任务去重、异常暂停及中断后不盲目重发。

只拥有 `extension/core/queue.mjs` 和 `tests/queue.test.mjs`，以及 `.superpowers/sdd/task-1-report.md`。不要修改其他文件，不提交、不创建分支，不操作浏览器、不联网。用户 AGENTS.md 高于技能的提交/分支要求。

使用 TDD：先写测试并运行看到缺失功能失败，再实现。使用 Node 内置 test/assert，ES modules，零依赖。

## 公共接口

```js
export function initialState();
export function previewTask(state, config); // returns {items, sendableCount, skippedCount}
export function reduceQueue(state, event, {now = Date.now(), uid = () => crypto.randomUUID()} = {});
// returns {state, command: null | object}; no mutation of input state.
```

config：`{shop:{id,name},creators:[{id,name}],template,intervalSeconds,limit,mode}`，mode 为 `dry-run` 或 `send`。只支持 `{{name}}` 变量，未知变量、空名称/标识、空白消息、无名单、间隔非正有限数、limit 非正整数均抛可读中文错误。intervalSeconds 是最小间隔，无安全条数承诺。限制模板最大 2000 字、名单最大 200 人，避免无界存储。

初始状态：`{version:1,task:null,history:{},denied:{}}`，history 与 denied 使用店铺标识和达人标识分层键；使用 Object.hasOwn 或 Map 等方式防范特殊属性键，不要信任输入为正常对象键。

task：`{id,sessionId,binding:{tabId,pageId},config,status,items,nextAt,reason,createdAt,updatedAt}`。
item：`{id,name,text,status,reason,authorized}`，id 即稳定 creator id。状态 `pending|preparing|prepared|sending|sent|rehearsed|skipped|failed|uncertain`。重复列表行保留为 skipped 或先去重均可，但同人只能一次发送；跨模式同样检查已发送/uncertain 历史。dry-run 成功只记 rehearsed，不占真实发送历史。

## 事件契约

- `start {config,binding}`：无运行/未收尾任务才可开始；构建快照和新 id/sessionId，status running，nextAt=now。已有不确定项在新任务仍须通过 history 阻止发送。无任何待处理项则拒绝启动。
- `poll {tabId,pageId,shopId,sessionId}`：运行且绑定、店铺、session 全相符，且 now>=nextAt 时，把唯一 pending 项变 preparing，返回 `{type:'prepare',taskId,sessionId,itemId,creator:{id,name},text,mode}`。已有 preparing/sending 则不给指令。prepared 项在下一次 poll 变 sending，先写 history 的 uncertain 意图（dry-run 除外），返回 type send 的同形指令。一次派发后绝不能重新派发。时间只根据上一结果 now + interval 计算，禁止追赶补发。
- `prepared {tabId,pageId,shopId,sessionId,itemId,ok,reason}`：仅接受匹配 preparing 项；ok true 置 prepared。否则置 failed 并暂停。暂停/停止过程中回报 ok 不准再发送，当前项安全回 pending，任务结束过渡态。旧 session/item 的回报忽略。
- `authorize {tabId,pageId,shopId,sessionId,itemId}`：仅 running、matching、sending、authorized false 才置 authorized true 并返回 `{type:'permit',taskId,sessionId,itemId,mode}`。发送端拿到许可后只点击一次；重复授权不给许可。暂停/停止前未授权的发送意图可安全清除，回 pending；已授权项无法判断是否触发，须等 result 或中断置 uncertain。
- `result {tabId,pageId,shopId,sessionId,itemId,outcome,reason}`：仅 matching sending 且 authorized 才接受。outcome `sent|rehearsed|failed|uncertain`；模式与 outcome 必须相符，否则 uncertain。sent 写 history confirmed，rehearsed 不写 history，failed/uncertain 均暂停（发送模式的失败保守保留 history uncertain）。成功后 nextAt=now+间隔；若无 pending 则 completed，暂停/停止请求优先。
- `pause {reason?}` / `stop`：无活跃准备/已授权发送时直接 paused/stopped；preparing 则 pausing/stopping；已授权 sending 则 pausing/stopping，等回报核对。未授权 sending 可立即取消并清除本次 history 意图，回 pending。之后 poll/authorize 不得产生新动作。
- `interrupt {reason}`：标签页关闭或新 pageId 替代时调用。preparing/prepared 回 pending；sending 若已授权则 uncertain（不重发），未授权则 pending 并清除意图；task paused，保留 reason。旧会话 result 不得覆盖 interrupt 后状态，恢复前使 sessionId 换新或 invalid。
- `resume {binding}`：只允许 paused/stopped 且无 uncertain 项；更新 binding 与 sessionId，status running；若无 pending 则 completed；已发送项不能重发。failed 项转 skipped（不会自动重试失败）。
- `resolve {itemId,resolution:'sent'|'skip'}`：仅非 running 且 uncertain 项可人工核对。sent 写 confirmed，skip 仍保留阻止自动重发的 history，但允许继续其他项；更新 item 状态。
- `deny {shopId,creatorId,name,blocked:boolean}`：增加/解除拒绝名单；运行期间不得更改任务配置，但 deny 可让后续 pending 项在 poll 时跳过。

## 验证重点

模板空值与未知变量；同名单去重；跨店铺 history 隔离；拒绝名单；limit；单任务互斥；间隔；旧会话回报；重复 poll；双 authorize；准备时暂停；授权前/后暂停；中断后 uncertain 和人工核对；dry-run 不污染真实记录；错误 outcome；存储输入不突变。

报告写到 `.superpowers/sdd/task-1-report.md`，包含实际 RED/GREEN 命令和结果、自审与 concerns。最后只返回状态、测试摘要和报告路径。
