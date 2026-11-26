# 消息模板管理实施计划与并行接口

用户已批准模板数据、模板界面与独立验证并行开发；本轮不实现任意多消息编排。

## 产品行为

- 模板只保存名称、原话术与产品链接，可保存新模板、改名/更新已有模板、复制模板。模板为本机通用，不绑定店铺或达人；不保存发送模式、人数、间隔、名单或发送确认。
- 工作台选择模板后须点击“套用”；只选择、保存、更新或复制不会自动覆盖草稿。套用更新话术、链接及预览，撤销旧发送确认，其他配置不变。
- 运行中任务的配置保持不可编辑；界面在未完成任务或业务操作忙碌时禁止套用/保存/更新/复制。准备名单期间原本允许手工填写消息，因此同样允许模板操作，但不得修改名单或人数。后台模板管理独立于队列，不改变任何任务、名单或防重发状态。
- 不新增删除、导入、定时发送、图片或第三方服务。数据仅保存在本机，界面沿用现有工作台风格。

## 数据契约

存储键：`creatorMessageTemplates`，形状 `{version:1,templates:[record]}`；缺少键视为空，不写入初始化值。未知版本/损坏数据明确报错并保留原值，不阻断正在运行的队列。

`record = {id,name,template,productLink,revision,createdAt,updatedAt}`。

- 名称去首尾空白，1–50 字符，禁止控制字符；名称按去首尾空白、小写比较，禁止重名。
- 话术保留原文，非空白、最多 2000 字符，仅允许 `{{name}}` 变量，未知/未闭合变量拒绝。
- 产品链接去首尾空白，非空、最多 2000 字符，使用现有队列相同的 HTTP/HTTPS 完整网址规则，拒绝多行、空主机和内嵌凭证。
- `revision` 为正安全整数，新建为 1，每次更新加 1；更新与复制要求 `expectedRevision` 等于当前版本，否则提示刷新。
- 时间为非负有限毫秒值；更新保留创建时间。ID 是非空字符串，不能复用已有 ID。
- 最多 50 条、整个存储 JSON UTF-8 上限 512 KiB；满时拒绝新增/复制，保留全部原值，仍可在容量内更新已有模板，不自动删除。
- 复制以原保存内容为准，不读当前草稿。可指定新名称；不指定时自动命名“原名 · 副本”，重复时递增为“原名 · 副本2”等，截断原名以保持总长度不超过 50 字符。

## 后台接口（均仅允许精确 dashboard.html 来源）

- `panel:template-list`，无业务参数。
- `panel:template-create {draft:{name,template,productLink}}`。
- `panel:template-update {templateId,expectedRevision,draft:{name,template,productLink}}`。
- `panel:template-copy {templateId,expectedRevision,name?}`，省略 name 时自动命名。

成功返回 `{messageTemplates:{version:1,templates:[record],capacity:{count,limit:50,bytes,maxBytes:524288}}, savedTemplateId?}`。模板按 updatedAt 从新到旧，再按 ID 排序。仅写成功后返回保存成功；写失败保留旧数据、允许重试，不设置业务故障或消耗队列预览令牌。

这些接口在业务初始化前分流，只读取/写入模板存储键，沿用后台串行顺序以处理并发；不读取会话、页面、队列或历史，不执行过期、重连、注入、发送，也不记录/刷新排查日志。业务写盘故障时模板读取仍可用；模板写故障不直接改变业务状态。普通任务接口仍只允许工作台，历史页不能管理模板。

纯模块 `extension/core/message-templates.mjs` 导出：

- `emptyMessageTemplates()`。
- `readMessageTemplates(value)` → 已校验的存储副本。
- `listMessageTemplates(store)` → 上述 messageTemplates 内容。
- `createMessageTemplate(store,draft,{id,now})` → 新存储。
- `updateMessageTemplate(store,{templateId,expectedRevision,draft},{now})` → 新存储。
- `copyMessageTemplate(store,{templateId,expectedRevision,name?},{id,now})` → 新存储。

## 界面与协作边界

模板控件在任务设置内：已存模板选择框、刷新按钮、套用按钮、名称输入、存为新模板、保存修改、复制按钮及状态提示。选择模板仅更新名称输入和选择状态；套用才改话术/链接。更新以当前草稿与名称输入为准；复制默认生成新名称，并在保存成功后选中新模板、更新名称输入，但不自动套用复制内容。无模板/断网/旧后台/存储失败均保留草稿，错误提示可操作。

异步列表和保存响应按各自序号处理，迟到结果不能覆盖新选择、用户后续改动的名称或当前草稿。模板操作不通过发送/恢复/名单接口；套用后调用现有预览与确认重置逻辑，不新增发送分支。列表加载不占据业务轮询状态，不把没有 state/workspace 的模板响应提升为业务状态序号。

并行分工：

1. 数据代理独占 `core/message-templates.mjs`、`core/backend.mjs`、`tests/message-templates.test.mjs`、`tests/template-backend.test.mjs`；不改队列/执行器/界面。
2. 界面代理独占 `dashboard.html/mjs/css`、`tests/dashboard.test.mjs`；不改后台/纯模块。主代理完成接口整合和最终验收。
3. 验证代理只读复查规格、后端/界面的执行链副作用；可新增独立 `tests/template-isolation.test.mjs`，不改实现文件。发现问题由对应实现者修复并补测。

## 验证和完成清单

- [x] 两条实现线均先运行预期失败测试，再实现和局部回归。
- [x] 独立检查旧数据兼容、重名/版本冲突、容量/写盘故障、来源隔离和零业务副作用。
- [x] 检查套用预览、确认撤销、任务锁定、跨窗口/迟到响应及不修改其他配置。
- [x] 主代理运行正式 Node 行为测试与 `node scripts/check.mjs`，在新建的本地预览标签页检查交互与布局。正式 210/210；全量 214 项仅暂停测试包的已知导入检查失败，详见验证记录。
- [x] 更新项目约定、README 和验证记录，所有修改留在工作区，不创建分支、提交或推送。

仍遵守本地测试插件暂停规则：不修改生成器、不生成或安装测试扩展、不为其已知依赖检查失败阻塞正式功能。本轮不向真实达人发送或重载已安装扩展。
