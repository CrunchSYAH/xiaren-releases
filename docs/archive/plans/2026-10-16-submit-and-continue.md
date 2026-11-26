# 提交后继续下一位 Implementation Plan

**Goal:** 按用户最新要求，不等待送达或已读回执；受控发送点击完成后记为已提交并按间隔继续下一位。

**Architecture:** 后台仍先持久化单次提交声明，再在MAIN同步核对账号、收件人、文档、路由、锁定名单及文本并点击。点击返回成功后，后台在同一串行处理内保存已提交结果；content不再等待回执或自报成功。保留原存储结构和历史状态值以兼容旧记录，界面将sent显示为已提交。

**Tech Stack:** Chrome MV3、原生JS模块、Node行为测试。

## Constraints

- 不执行真实发送，不重载或恢复用户当前任务；本地测试插件继续搁置。
- 不commit、push、创建分支或改历史。
- 去除回执、历史编号和空历史推断前置条件；不得去除身份、文档、名单、草稿检查及单次声明。
- 点击前失败不点击；点击或写盘结果不明时保留待核对，不重试。成功提交不证明平台接受、送达或已读。

## Task 1: 原子提交与队列推进

Files: `extension/core/backend.mjs`, `extension/content.js`, `extension/core/page-guards.mjs`, `extension/page-snapshot.mjs`, `tests/backend.test.mjs`, `tests/content.test.mjs`, `tests/target-content.test.mjs`, `tests/snapshot.test.mjs`, `tests/guards.test.mjs`, `tests/target-backend.test.mjs`, `tests/target-receipt.test.mjs`。

- [x] 先补回归：不返回消息回执时单次commit后立即sent；重复commit不点击；丢失点击返回仍uncertain；丢失content回包不撤销已持久化提交；按间隔处理100人。
- [x] 执行 `node --test tests/backend.test.mjs tests/content.test.mjs tests/target-content.test.mjs`，确认新增用例先失败。
- [x] 将 `page:commit` 成功分支改为保存committed并调用原reducer的result/sent；content仅请求commit，不轮询或发送成功结果。页面快照移除消息、历史和回执读取，guards仅检查身份和控件；backend阻止content自报sent/failed推进真实任务。
- [x] 将旧回执测试改为新提交契约下的身份、文档、名单、一次性、存储与间隔行为测试；保留真正的安全回归，不保留废弃行为断言。
- [x] focused检查通过后，运行README中的正式功能测试及8个正式脚本语法与manifest权限检查。

## Task 2: 结果说明与复审

Files: `extension/dashboard.mjs`, `extension/dashboard.html`, `README.md`, `AGENTS.md`, `docs/verification-2026-10-16-submit-and-continue.md`。

- [x] sent展示为已提交；说明提交后按间隔继续，不等待送达或已读，未确认提交的中断仍需核对。
- [x] 独立只读代码审查检查主事件链、状态恢复、单次点击、旧持久化记录兼容、重复/过期结果、无回执100人推进和废弃逻辑清理。
- [x] 修复审查发现，重读改动并重新跑相关验证；最终报告实际证据和真实发送未验收边界。
