# 实际验证记录：无登录页 / 私人设备绑定

验证日期：2026-10-09（Asia/Singapore）。以下为本地真实执行结果，不代表 Supabase 云端和 iOS 真机验收已完成。

## 已通过

| 检查 | 结果 |
|---|---|
| npm install | 原项目安装成功，依赖和锁文件未改变 |
| npm run build | 新版 Next.js 16.4.0 生产构建成功，路由列表没有 /login |
| npm run typecheck | 新版构建后成功，无类型错误 |
| npm test | 11 项全部通过 |
| 移除登录 | /login 返回 404，首页没有邮箱或密码输入框 |
| 设备设置页 | 未配置真实 Supabase 时明确显示设置提示，绑定按钮禁用，不模拟授权成功 |
| 受保护 API | 无会话的 /api/data、同源 /api/records、/api/push/test 均返回 401 |
| 设备状态 API | 缺少服务配置时 /api/device 返回 503，显示可恢复错误 |
| 440×956 视窗 | 根宽 440、根高 956，无根页面横向/纵向溢出 |
| 缩小视窗 | 440×430 时 shell 高 430，内容高 727，内部滚动可访问内容 |
| 浏览器运行错误 | Edge 隔离 headless 移动尺寸检查没有 pageerror |
| 依赖安全 | 原项目最终审计 0 漏洞；本次没有改变依赖 |

## 11 项测试覆盖

1. PostgreSQL 001 迁移、RLS、精确金额视图、CRUD 和唯一约束。
2. 执行 001 + 002 和实际 setup-device.sql：批准的设备可访问并修改原 owner 记录；陌生设备读不到所有财务表/视图，不能自行插入 authorized_devices；撤销后立即失去权限，财务记录仍保留。
3. 首次设备批准初始化一个账本和 8 个分类；重复批准不重复创建；重绑新设备保留原 owner ID；原始 owner 设备同样可以被撤销。
4. BigInt 分运算与最大金额。
5. MYR/SGD 和月份隔离。
6. 50/80/100% 预算阈值。
7. UTC → 新加坡日期和闰日。
8. 当前/最长连续复盘天数。
9. CSV BOM、引号/换行和公式注入保护。
10. 非法金额、日历日期和币种校验。
11. 推送 endpoint 限制。

数据库测试使用 PGlite PostgreSQL 引擎，执行真实迁移、函数和策略。仅模拟 Supabase 的 auth.uid() 与数据库角色，跳过 pgcrypto 扩展包装行；gen_random_uuid 是 PostgreSQL 内建功能。没有模拟财务保存成功。

## 仍待你的实际服务配置

- 在真实 Supabase 启用匿名会话，执行 002 迁移，生成并批准主屏幕安装的 Device ID。
- Vercel 环境变量和实际生产部署、Cookie 会话刷新、真实 PostgREST CRUD。
- 真机自动进入、会话丢失后的重新绑定、键盘、Safe Area、VoiceOver。
- iPhone 的真实推送订阅、实际送达和定时任务。

按 README 的新版设备绑定流程配置，然后完成 ACCEPTANCE.md。清除浏览器数据后需要批准新会话；不要删除 app_owner 指向的 Auth 用户，避免级联删除账本。
