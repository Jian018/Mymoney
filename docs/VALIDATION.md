# 实际验证记录

验证日期：2026-10-09（Asia/Singapore）。这是本地真实执行结果，不代表真实 Supabase / iOS 验收已完成。

## 已通过

| 检查                                | 结果                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| npm install                         | 成功，生成 package-lock.json                                                    |
| npm run typecheck / 构建 TypeScript | 成功，无类型错误                                                                |
| npm run build                       | 成功，Next.js 16.4.0 webpack 生产构建，全部页面/API 编译                        |
| npm test                            | 9 项测试全部通过                                                                |
| npm audit                           | 更新 sharp 后报告 0 漏洞；最终生产依赖检查也为 0                                |
| 图标生成                            | 四个真实 PNG 已生成并通过 HTTP 200 检查                                         |
| 生产服务启动                        | npm start 成功，本地 http://localhost:3000                                      |
| 登录页                              | 未配置环境时显示设置提示，禁止模拟登录                                          |
| 浏览器运行错误                      | Edge 隔离 headless 移动尺寸测试没有 pageerror                                   |
| 440×956 根布局                      | 根宽 440、根高 956，body overflow hidden，输入字号 16px                         |
| 缩小视窗                            | 440×430 时 shell 高 430，内部内容高 837，可在内容区滚动                         |
| PWA 资源                            | Manifest standalone、SW、offline、apple-touch-icon、全部 manifest 图标 HTTP 200 |
| Cron 鉴权                           | 未提供 Authorization 时 HTTP 401                                                |
| 写入同源检查                        | 无 Origin 的 POST /api/records 返回 HTTP 403                                    |

9 项自动测试覆盖：

1. 本地 PostgreSQL 引擎执行实际迁移、owner 初始化、RLS、精确金额视图、增改删、请求 ID 去重、预算/复盘/提醒唯一约束、错误分类关联、非 owner 所有表/视图不可读写、匿名访问被拒绝。
2. 金额 BigInt 分运算与最大金额。
3. MYR/SGD 和月份隔离。
4. 50/80/100% 预算跨阈值。
5. UTC→新加坡日历日期及闰日。
6. 当前与最长连续复盘天数。
7. CSV BOM、引号/换行、公式注入保护。
8. 非法金额、错误日历日期和币种校验。
9. 推送 endpoint 限制，拒绝内网和任意域名。

数据库测试使用 PGlite PostgreSQL 引擎，仅模拟 Supabase 提供的 auth.uid() 和角色，跳过扩展包装行（gen_random_uuid 是 PostgreSQL 内建功能）。测试执行迁移中的真实表、策略和约束，不是伪造数据库成功。它不验证 Supabase 云端 Auth/PostgREST 服务。

最初受 Windows 文件系统沙箱的路径解析限制，构建无法启动；在允许的构建执行环境中重跑成功。该限制属于本地工具环境，不需要修改应用逻辑。

## 仍需真实账号 / 真机验证

- Supabase 云项目配置、邮箱密码实际登录、Cookie 会话刷新、真实 PostgREST CRUD。
- 生产 Vercel 导入仓库、环境变量、HTTPS 域名、Cron 实际执行。
- iPhone 主屏幕安装、Dynamic Island / Home Indicator、iOS 键盘和 VoiceOver。
- 手机上的实际 Web Push 订阅、消息送达、点击通知、Focus/离线表现。
- 登录后全部五个页面在真机上的完整业务验收。

这些测试没有虚构账号、秘密、财务记录或推送送达。按 README 配置后完成 ACCEPTANCE.md，再确认生产就绪。
