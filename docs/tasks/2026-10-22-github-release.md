# GitHub 发布与更新入口

- 用户于 2026-10-22 授权创建 GitHub 发布仓库、增加页面更新按钮、递增版本号并打包发布；后续明确要求上传 GitHub、公开仓库及 .gitignore。发布正式源码、必要脚本和公开说明；私钥、本地配置、内部记录和测试产物不上传。
- 范围：独立更新页面与入口、Windows 本地更新脚本、正式打包脚本、版本号与使用说明。业务发送、存储及权限保持原流程；禁止真实发送和生成暂停中的测试插件。
- 更新流程：工作台打开独立更新页，用户下载正式 Release；本地脚本校验并备份后更新固定 extension 目录，用户在各 profile 重新加载。更新前须结束任务。
- 文件归属：协调者实现；eng_test 独立测试，可补充 tests/release-update.test.mjs；eng_audit 只读审计。未派实现角色，不宣称协调者运行时档位已核实。
- 当前阶段：2026-10-23 网络恢复后，已将44个白名单文件上传公开仓库 `CrunchSYAH/xiaren-releases`，提交 `b71e5ae`；正式 Release `v0.1.2` 已发布并标为 Latest，含 ZIP 和 SHA256 两个附件。
- 版本目标：0.1.2。重试修复了测试 wrapper 参数错误及回滚恢复容错；独立测试者补充双故障测试，独立审计者复核未见新的明确代码级阻断。
- 最终验证：协调者独立运行发布专项 6/6；正式 Node 套件（排除暂停的本地插件测试及动态 CMD 测试）498/498，通过记录 `artifacts/github-release-final-tests.log`；`node scripts/check.mjs` 通过。
- 安装包：`artifacts/xiaren-chrome-v0.1.2.zip`，同名 `.sha256`；SHA256 为 `55b7d368a4b03bde40bf0c3b01004fe2f21395fcca591a7ab91bd9c02f69d5c7`，已复核 ZIP 条目及哈希一致。
- 待上传公开源码白名单暂存路径记录于 `artifacts/github-public-stage-path.txt`，仅 extension、distribution、打包脚本、package.json、公开 README 和 .gitignore，共44文件；已核对无私钥及常见凭证模式。不要上传旧暂存目录中的 patch 文件、内部任务记录或工作区整目录。
- 公开验证：GitHub releases/latest API 返回 `v0.1.2`、draft=false、prerelease=false；从公开 Release 地址重新下载 ZIP，SHA256 与本地正式包完全一致。发布地址：https://github.com/CrunchSYAH/xiaren-releases/releases/tag/v0.1.2 。未在真实用户安装目录执行升级，不进行 Shopee 发送。
