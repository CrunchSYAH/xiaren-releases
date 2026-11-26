# 达人项目对虾仁的改进价值评估

## 范围与状态

- 用户要求研究所列项目对当前项目的改进价值和后续开发方向；本次仅调研，不构成选型、接入或业务开发批准。
- 日期：2026-10-31，Asia/Shanghai。读取项目 AGENTS.md、通用工程规程及已有 SDK 评估。
- 未安装候选依赖、未运行第三方代码、未调用业务接口、未发送消息；仅新增本记录。
- GitHub 搜索工具没有返回可用内容，改用 web-access 技能允许的公开静态原文读取；GitHub tree API 返回 403 公共出口限流，未取得固定提交和完整目录，不能断言仓库不存在其他实现。下列在线内容是本次读取的 main 分支，不是不可变版本。
- 没有运行业务测试：未修改业务代码。现有发送、真实发图、平台接受及回执证据缺口保持不变。

## 当前实现基线

直接阅读 `extension/core/creator-library.mjs`、`extension/core/message-templates.mjs`、`extension/manifest.json`，检索 queue/task-history；SDK 结论参考 `2026-10-28-shopee-sdk-assessment.md`，未把该快照当作最新远端版本。

- 达人库已有店铺范围、身份类型、标签、备注、关键词筛选、JSON/CSV 导入导出、版本冲突保护及页面核实映射；不应重新开发同类功能。
- 模板已有消息序列、名称去重和版本校验；值得补的是产品资料、场景和个性化预览。
- 当前 manifest 为无构建 MV3 扩展，仅印尼 Shopee 卖家域名，不能直接承接 Electron/SQLite/Python 或远程服务依赖。
- 当前发送任务状态与合作业务状态应保持独立。已提交不代表送达、回复、同意合作或已寄样。

## 候选核查

### Crevideo Reach：借鉴运营流程，服务接入留待 TikTok 需求成立

来源：

- https://github.com/crevideo/crevideo-reach/blob/main/README.zh-CN.md
- https://github.com/crevideo/crevideo-reach/blob/main/LICENSE

读取 README 与 MIT 许可证。README 声明远程 OAuth MCP 服务，涵盖定向合作、DM、邮件、分群、漏斗和运营技能；这些是作者能力声明，未调用验证。README 工具总数与局部版本说明存在差异，不以数量判断能力。

适合借鉴：品牌及产品知识包、达人适配评分、回复分类、合作漏斗、日常复盘。不能据此认为远程发送引擎已开源，也不能把 TikTok DM 实现移植到 Shopee。

两个猜测的 skill 路径返回 404，未读取技能正文；不把 README 的流程描述当作已审查的实现。费用、真实授权市场和账号权限未核验。

### LinkFox：AMS 网关包装，适合接口探索

来源：

- https://github.com/linkfox-ai/linkfox-skills/blob/main/LICENSE
- https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-shopee-store-ams/references/api.md
- https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-shopee-store-ams/references/apis/create-new-targeted-campaign.md
- https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-shopee-store-ams/scripts/ams_api.py
- https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-shopee-store-ams/scripts/_ams_api_runner.py
- https://github.com/linkfox-ai/linkfox-skills/blob/main/skills/linkfox-shopee-store-ams/scripts/_ams_endpoints.py

MIT 许可证；文档列出 36 个 AMS 接口，经 LinkFox developerProxy 转发，依赖 API Key 与选店授权。读取的 runner 实际负责 GET 参数或 POST body 组装、调用网关、合并响应，没有在这些入口看到达人聊天发送实现。

发现明确的接入细节：创建定向活动文档的示例只传 shopId，而 runner 的 POST 分支要求 body/requestBody 或 registry 声明的 body_fields；读取到的创建活动 registry 未给出完整业务字段。该示例不足以完成创建活动，仍需官方 schema 与真实权限核验。

可用方向是推荐达人、资料补充、合作活动与效果数据；不替代聊天。优先以只读数据验证价值，再决定使用网关还是直接 SDK。费用、印尼账号可用性和官方当前字段未核实。

### Shopee SDK：沿用现有评估，作为数据层参考

来源：

- https://github.com/congminh1254/shopee-sdk
- 本项目 `docs/tasks/2026-10-28-shopee-sdk-assessment.md`

已有本地源码快照评估，MIT、Node 运行环境，AMS 管理与 schema 可研究；未发现聊天发送接口，伙伴 ID 不能视作聊天用户 ID。此次未重新拉取该仓库。

推荐独立只读工具生成当前达人库可接受的文件；不把签名密钥塞进扩展，也不照搬鉴权刷新后的请求重放到发送操作。实际权限成立后再核对官方文档与字段。

### TikTok Creator Scraper：参考数据质量与增量更新

来源：

- https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/README.md
- https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/package.json
- https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/LICENSE

读取 README、package.json 和许可证正文前段。GPL-3.0，Electron/SQLite/Puppeteer 技术栈，与当前 MV3 结构不同；未深入采集或活跃度算法源码，不宣称其运行已验证。

可借鉴：字段来源和核查时间、未知值留空、先保存基础行再补详情、新增与刷新区分、活跃/不活跃/未知的解释依据。Shopee 可用数据必须另行验证，不能照搬 TikTok 字段或接口。

本轮不复制实现；若以后确需复制代码，先完成具体文件与分发方案的许可兼容核查。

### TikTok Creator SOP Tool：最有价值的产品参考，当前代码不可按 MIT 直接复用

来源：

- https://github.com/hazelhu644-collab/tiktok-creator-sop-tool/blob/main/README.md
- https://github.com/hazelhu644-collab/tiktok-creator-sop-tool/blob/main/LICENSE

当前 LICENSE 明确为专有授权，并说明历史 MIT 许可只覆盖此前获得的相应副本；不据此推断当前 main 可自由复制。

README 展示合作阶段、寄样/视频进度、每日跟进、场景文案。当前 README 同时出现账号审批与旧的“无登录、无数据库”描述，说明文档有未同步部分，部署形态不能仅靠 README 下结论。

适合独立设计类似业务需求：待处理回复、下次跟进、寄样与内容交付。文档中的天数是该工具的业务规则，不能直接当作虾仁用户已确认规则或印尼站通用要求。

### 两个展示项目

来源：

- https://github.com/Zeeshanahmad4/TikTok-Shop-Affiliate-Outreach-Bot/blob/main/README.md
- https://github.com/cogwork-labs/TikTok-Shop-Affiliate-Pipeline/blob/main/README.md

读取到的 README 分别导向 TTinit 商业服务和 showcase 案例，未据此验证发送引擎源码。完整目录受 API 限流未核验；只列为功能参考，不列为已确认可部署候选，不采用其营销成效数字作为证据。

## 推荐开发顺序

1. **合作跟进首版**：关联现有达人库与店铺，新增产品/合作事项、人工业务阶段、下次跟进日期及今日待办；同一达人允许不同产品的独立合作记录。发送事实只读关联，不改现有防重发规则，不自动催发。验收重点是跨店隔离、多合作并存、暂停与完成不会继续生成待办、版本冲突及旧数据读取。
2. **产品资料与话术预览**：统一产品名称、链接、佣金和寄样条件，按首邀/回复/寄样/催内容场景生成草稿。缺值明确报缺，逐人预览，发起任务前冻结最终消息；任何变量或 AI 输出必须进入原验证与人工确认链，不在发送时临时生成。
3. **有来源的数据补充和排序**：保存数据来源、核查时间和缺失状态，允许人工或经授权的数据导入。先做可解释的筛选，后做有证据的评分；无数据不能判为零或不活跃。
4. **AMS 只读试验，再评估定向合作**：先证明真实印尼店铺能查询且数据有用，再设计独立定向活动任务。提交前预览商品/佣金/期限/伙伴，持久化提交意图；超时先查询核对，不盲目重建。开放平台权限、费用与官方字段是前置条件。
5. **TikTok 独立扩展路线**：有明确业务需求再立项。平台身份、店铺权限和发送执行链分开；只有待办、产品资料与运营分析等平台无关部分值得共用，当前不增加第二平台适配层。

## 实施建议与边界

推荐先细化“本地合作跟进首版”，功能范围限制在合作阶段、产品关联、下次跟进和今日待办，继续沿用现有插件部署方式。新模块宜独立存储和处理入口，避免把业务跟进状态加入发送队列状态机。

这是产品方向建议，不是已经批准的模块方案。若进入实施，按通用工程规程确认首版需求、选型与实施边界；独立产品模块应重新判断 MVP 前置流程适用性。

现有真实发送和发图仍需在用户指定测试达人并明确授权后验收；本次调研不新增发送授权，也不恢复已暂停的本地测试插件工作。
