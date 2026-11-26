# Task 1 实现报告

状态：完成。

## 交付

- `extension/core/queue.mjs`：零依赖纯 reducer，导出 `initialState`、`previewTask`、`reduceQueue`，输入通过快照隔离且不会原地突变。
- `tests/queue.test.mjs`：26 项 Node 内置行为测试，覆盖配置验证、名单去重、店铺隔离、拒绝名单、limit、单任务互斥、间隔、全身份匹配、重复 poll、双授权、暂停/停止竞态、中断、人工核对、演练隔离、错误 outcome、特殊属性键和 JSON 存储往返。
- 仅修改本任务分配的三个文件；未提交、创建分支、操作浏览器、联网或写入凭证。

## 真实 RED / GREEN 记录

环境：Windows PowerShell；`node --version` → `v24.18.0`。

1. RED，先写 21 项测试，再运行 `node --test tests/queue.test.mjs`，退出码 **1**，**0 pass / 21 fail**。当时实现文件不存在：首项通过显式断言得到 `缺少 initialState`，其余失败来自尚不可用的 API；为使缺失 API 的原因直接可见，初始测试用动态 import 的空 API 回退，而不是让测试文件在导入阶段整体退出。
2. GREEN，首次实现后运行 `node --test tests/queue.test.mjs`，退出码 **0**，**21 pass / 0 fail**。
3. 自审补充 5 项已有行为的边界回归覆盖，并移除导入回退，使未来导入错误直接报告；再次运行 `node --test tests/queue.test.mjs`，退出码 **0**，**26 pass / 0 fail**。
4. 语法验证：`node --check extension/core/queue.mjs`，退出码 **0**，无诊断输出。

没有运行浏览器、真实 Shopee、平台发送或全项目集成测试；本任务仅负责纯队列，以上测试不能证明实际页面选择器或发送回执有效。

## 实现与接口细节

- `history[shopId][creatorId]` 值为 `{status:'confirmed'|'uncertain',taskId,sessionId,updatedAt}`；任何已有历史都会阻止自动发送，按店铺隔离。
- `denied[shopId][creatorId]` 值为 `{name}`；解除时删除该键。读取使用自有属性判断，写入使用 `Object.defineProperty`，`__proto__` / `constructor` 不会触发原型属性语义。
- `prepare` 成功后需下一次 poll 才派发 `send`；真实发送在派发 send 前记录 uncertain 意图。只有匹配的 sending 项首次 authorize 返回 permit，只有已授权项接受 result。
- 未授权发送暂停可移除本次意图；已授权发送需等待回报或中断后标为 uncertain。interrupt 将 sessionId 置 null；resume 生成新 sessionId，旧页面回报不会覆盖状态。
- 暂停/停止优先于成功完成；失败恢复只转 skipped；人工 skip 保留真实发送的 uncertain 历史。演练成功/演练人工完成均记 rehearsed，始终不写真实发送历史。
- paused/stopped 尚未完成的任务不能被 start 覆盖，需 resume 收尾；这是“无运行/未收尾任务才可开始”的保守实现。

## 自审

- 主链路：start → poll/prepare → prepared → poll/send → authorize/permit → result → 间隔后下一项；每个派发阶段只推进一次，重复事件不能重复授权。
- 状态与时序：暂停前后、停止升级、准备中的晚回报、授权后中断、最后一项成功与暂停竞争均有测试；间隔从成功结果时间计算，不追赶补发。
- 维护性：模板验证、分层存储、身份匹配、命令构建和历史操作集中在小 helper；没有平台访问、额外依赖或持久化副作用。
- 数据隔离：配置复制为明确字段快照；reducer 深复制输入；特殊键与冻结输入均有测试。

## Concerns / 调用层责任

- 调用方必须串行处理状态变更，并在派发 prepare/send/permit 前先持久化返回 state；否则并发读取旧状态或崩溃恢复可能破坏单次授权保证。已告知主代理。
- 页面连接丢失、浏览器/worker 重启恢复及 prepare/result 超时由调用层派发 interrupt；队列不会自行猜测是否已点击发送。
- 默认 now 假设为有效毫秒时间，uid 假设会产生不同标识；生产默认使用 Date.now / crypto.randomUUID，测试注入确定值。
- dry-run 出现错误结果或中断仍要求人工核对，但不会生成真实发送 history；resolve(sent) 在演练任务内按 rehearsed 处理，以满足演练不污染真实历史的约束。已告知主代理。

未发现本模块范围内仍待修复的问题。
