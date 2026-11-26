# Shopee SDK 本地评估

## 目标与范围

- 用户于 2026-10-28 要求下载 congminh1254/shopee-sdk，并评估对虾仁的帮助。
- 本轮只下载和静态阅读源码、对照当前项目；不安装依赖、不执行第三方脚本、不调用 Shopee 业务接口、不修改业务代码。
- 主协调者直接完成，无子代理、独立测试或审计；本轮不是接入实施任务。

## 下载证据

- 来源：https://github.com/congminh1254/shopee-sdk
- 原始快照：https://codeload.github.com/congminh1254/shopee-sdk/zip/HEAD
- 本地目录：`D:\Documents\ChatGPT\references\shopee-sdk-20261028\shopee-sdk-HEAD`
- 压缩包：同级 `source.zip`，SHA-256 为 `33A9F522D89CD43C4B45C2477663CB8BF7F5F2934F84A1D9F62256C932D0FA5F`。
- 下载时 package.json 标注版本 2.12.0。GitHub 提交 API 遇到公共出口限流，未取得提交 SHA；这是 HEAD 下载快照，不宣称为固定提交或已核实的最新发布版本。
- MIT 许可见下载目录 LICENSE；如复制代码，保留相应版权及许可声明。

## 结论

保留为开放平台和 AMS 能力参考，当前不建议作为扩展依赖。潜在价值主要在达人资料、推荐名单、合作活动和业绩数据，无法直接解决现有达人聊天执行、图片发送和平台回执验收。

### 可利用的能力

- `src/managers/ams.manager.ts` 封装伙伴查询、推荐伙伴、已管理伙伴、伙伴业绩和定向活动等 API。
- `src/schemas/ams.ts:2891` 的 queryAffiliateList 支持按伙伴 ID 列表查询，或按名称模糊匹配；注释声明最多返回 200 人。
- `src/schemas/ams.ts:1900` 的推荐名单请求只有 page_size，注释声明推荐前 200 人。不能据此视为现有广场、排行榜及全部筛选的等价替代。
- `src/schemas/ams.ts:2976` 的查询结果包含 affiliate_id、名称、社交账号、点击数、订单/GMV 区间及部分内容和商品信息。实际字段可缺失，数据权限和印尼站可用性未实测。
- 未来最小路径：独立 Node 工具只读获取数据，转换为现有达人库 JSON/CSV，明确使用 affiliate_id 身份类型及真实店铺范围；继续走原有页面身份核对和名单准备。

### 当前无法直接替代的部分

- 搜索全部 managers 和原始 schemas 的 send_message、sendMessage、conversation、/chat、/im/，未发现聊天发送接口；不能把 README 的完整覆盖宣传理解为包含卖家后台全部内部接口，也不能据此断言 Shopee 官方绝无其他聊天接口。
- AMS 查询和推荐响应没有 shopee_user_id 聊天用户映射；user_name 是名称字段。当前 `extension/core/affiliate-resolver.mjs` 和 `extension/page-snapshot.mjs` 仍需核对伙伴、真实用户及会话收件人。
- 定向活动的 seller_message 是活动参数，不能视为聊天消息或现有多消息队列的替代。
- SDK 的媒体上传不构成当前页面聊天附件组件兼容性和真实发送的证据。

### 接入成本与风险

- SDK 文档要求 AMS 权限；代码要求 partner_id、partner_key、令牌及相应授权。当前浏览器登录态不足以满足这些配置，具体账号是否拥有权限待开放平台核验。
- package.json 要求 Node >=20，并依赖 node-fetch；签名代码使用 Node crypto，请求层使用 Buffer。无法直接导入当前无构建的 MV3 扩展，需要独立运行环境或移植，并处理密钥保管和权限范围。
- 当前达人库以字符串保存 ID；SDK AMS 响应把 affiliate_id 定义为 number。未来转换前必须检查安全整数，已发生精度损失后转字符串无法恢复原值。
- 请求层在鉴权错误后刷新令牌并重放一次请求（src/fetch.ts:314）；不能将其直接移植为当前“结果不明不自动重试”的发送策略。
- 本轮阅读到的 AMS manager 测试以 mock 替换 ShopeeFetch.fetch；integration 目录未找到以 ams/affiliate 命名的测试文件。以上不能证明印尼实际账号拥有权限或接口业务可用。

## 验证与下一步

- 已完成：解压源码、核对压缩包摘要、阅读包配置/许可/AMS manager 与 schema/签名及重试逻辑，对照现有 manifest、达人库、伙伴身份解析和最终提交核对。
- 未运行：SDK 安装、构建、测试、真实 API 请求及发送；当前项目测试未运行，本轮无业务代码修改。
- 推荐下一步：在确有开放平台应用和 AMS 授权条件时，先做只读查询与达人库导入试验，再决定是否正式接入。当前没有启动该实施工作。
