# My Money

专为 iPhone 16 Pro Max 竖屏设计的单用户个人财务 PWA。Next.js App Router、React、TypeScript、Tailwind CSS、Lucide、Supabase Auth/PostgreSQL/RLS、标准 Web Push。

**没有演示财务数据，没有模拟数据库成功。** 未配置环境时显示设置提示。写入必须联网；数据库确认前不会显示“已保存”。仅显示一种币种的统计，CSV 保留原币种。

## 阶段 1：本地启动

需要 Node.js 22 或更新受支持版本，以及 npm。锁文件记录本项目实际安装版本。

```bash
git clone https://github.com/Jian018/Mymoney.git
cd Mymoney
npm install
cp .env.example .env.local
npm run dev
```

Windows PowerShell 用 `Copy-Item .env.example .env.local` 代替 `cp`。打开 http://localhost:3000。只有配置真实 Supabase 和唯一账号后才能登录。图标已包含在仓库；`npm run icons` 可以重新生成。

```bash
npm run typecheck
npm test
npm run build
npm start
```

## 阶段 2：Supabase 数据库与唯一账号

1. 在 [Supabase](https://supabase.com/dashboard) 创建免费项目，区域选择接近新加坡的区域。数据库密码只保存在你自己的密码管理器。
2. 在 Authentication → 配置/Sign In and Providers 中关闭 **Allow new users to sign up**（允许新用户注册）。保留 Email/Password 登录，关闭不需要的提供商。没有公开注册页面。
3. Authentication → Users → Add user：手动创建你唯一的邮箱/密码账号，并确认邮箱（管理界面可选择自动确认）。不要把密码发到聊天或写入代码。
4. SQL Editor 执行完整的 `supabase/migrations/001_initial.sql`，只执行一次。包含所有表、索引、约束、RLS 和金额文本视图。
5. 复制 Users 中该账号的 **User UID**。打开 `supabase/setup-owner.sql`，将全零 UUID 换成你的 UUID，然后执行。插入唯一 owner 会自动建立 profile、通知偏好和 8 个默认分类；不会创建任何收支数据。
6. Project Settings → API/Data API：取得项目 URL 和 publishable key。旧项目的 anon key 也可以用于 publishable 配置。不要混淆 service-role key。
7. 设置 `.env.local`：

| 变量                                   | 用途                                   | 是否可在浏览器出现 |
| -------------------------------------- | -------------------------------------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | 项目 HTTPS URL                         | 是                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable 或旧 anon key，受 RLS 限制 | 是                 |
| `ALLOWED_USER_ID`                      | 唯一账号 UUID，必须与 app_owner 一致   | 服务器读取         |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Web Push 公钥                          | 是                 |
| `VAPID_PRIVATE_KEY`                    | Web Push 私钥                          | **否**             |
| `VAPID_SUBJECT`                        | `mailto:你的邮箱`                      | 服务器读取         |
| `SUPABASE_SERVICE_ROLE_KEY`            | 仅每日任务使用，绕过 RLS               | **否**             |
| `CRON_SECRET`                          | 长随机字符串，保护每日任务             | **否**             |

8. 重启本地服务，用手动创建的账号登录。新增 MYR/SGD 收支，在 Supabase Table Editor 确认持久保存。刷新页面后应仍存在。

数据库权限不仅检查 `auth.uid()`，还检查单行 `app_owner`。即使错误地开启了注册，其他账号仍不能访问财务表。预算只能关联该账号的支出分类；交易分类必须匹配账号和收支类型。金额使用 `NUMERIC(14,2)`，读取视图将金额转成文本，应用用 `BigInt` 分计算，避免 JSON 浮点误差。

## 阶段 3：iPhone 界面

- 五个固定底部导航：Home、Transactions、Add、Reports、Settings。
- 根文档禁止滚动；仅 `.content` 和弹层内容允许滚动。
- `100dvh` 配合 `visualViewport` 高度/位置更新，键盘打开时缩小可用空间。所有输入至少 16px，保留文字选择和缩放能力。
- `viewport-fit=cover`，顶部/底部使用 safe-area 环境变量。弹层背景 `inert`、焦点限制、Esc/关闭恢复路径。
- 在大屏上保持 440px 手机布局；没有桌面仪表板。
- 竖屏 manifest 是偏好，无法保证所有 iOS 版本强制锁定系统方向。

## 阶段 4：财务功能

**交易**：Add 或首页快捷入口；金额、分类、币种、日期、备注；点列表记录编辑或确认删除。支持类型/分类/日期筛选，MYR/SGD 按币种切换。新交易有 UUID 请求标识，响应丢失后在同一表单重试不会重复插入。若关闭表单后重新创建，相同内容可视为另一笔交易，请在重试前检查列表。

**预算**：Settings → Budget management。每月每币种一个总预算，按分类可另设预算，分类与总预算重叠，不会相加。50%、80%、100% 阈值提示；保存跨阈值支出后立即显示提醒。月度金额按交易的日期字符串统计，不做隐式换汇。没有设置总预算时首页展示“收入−支出”，不会伪装成剩余预算。

**复盘**：每日确认所有开支已记录、是否有冲动购买、是否仍有漏记、备注和完成确认。如果漏记，先进入记账；没有支出记录时必须明确确认零支出。昨天未完成会显示待办。达到设定的应用内提醒时间时，打开/恢复应用会出现复盘弹层。可关闭或重试，网络错误不会阻塞恢复。历史可选日期补复盘；已完成记录可以更新。当前/最长连续天数基于新加坡日历。

**报表**：选择月份和币种；周支出、月内每七日分组、分类、收入与支出，全部来自 Supabase 记录；空数据不会填充假图表。

**导出**：Settings → CSV data export，按收支、币种和日期筛选。UTF-8 BOM、CSV 转义、公式注入保护；iOS 支持文件分享时使用 Share，否则下载 CSV。两种币种只保留独立行。导出前回到应用刷新，避免使用已加载的旧记录。

## 阶段 5：PWA 与真正的 Web Push

```bash
npm run vapid
```

公钥和私钥写入被 Git 忽略的 `.env.vapid.local`，私钥不会打印到日志。私下将其中两项复制到 `.env.local` 和 Vercel 的对应变量；设置 `VAPID_SUBJECT` 和 `CRON_SECRET`。可在密码管理器生成至少 32 字节随机 CRON_SECRET。保留同一对 VAPID 密钥；换密钥后须在设备重新订阅。

生产部署后从 iPhone 主屏幕打开应用，Settings → Notifications & reminders → Enable notifications。只在点击时请求权限。随后点击 **Send a real test notification**。看到“Provider accepted”只说明推送服务接收；只有手机实际显示通知才证明送达。测试每分钟最多一次，daily 每日最多一次。日志显示 pending/accepted/partial/failed；过期订阅 404/410 会自动删除。

`/api/push` 和 `/api/push/test` 需要唯一账号登录及同源请求；服务端按允许的推送提供商验证 endpoint。`/api/cron/reminders` 使用 `CRON_SECRET`，只向配置的单个 owner 发送。密钥仅通过服务器环境读取。点击通知会打开复盘页面。

### 每日定时与免费层限制

`vercel.json` 的 `0 13 * * *` 是 UTC 13:00，即新加坡 21:00。[Vercel Hobby 官方限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)为每天一次、小时级精度，通常在 21:00–21:59 之间执行，不能保证精确到分钟，也不能保证每次执行。任务仅在生产部署执行；当天已复盘或提醒/推送关闭时跳过。

设置里的自定义时间控制**应用内**提醒，免费后台推送保持 21 点时间窗。如改变推送时刻，修改 UTC cron 并重新部署。需要精确调度时必须另行选择可靠调度服务，不能声称当前免费配置保证准时。

日志唯一键在发送前占位，避免并发或平台重试重复发送。外部推送与数据库之间无法实现原子事务：若发送过程中服务崩溃，pending 可能保留且当日不自动重发，避免重复。没有订阅时不会伪造成功。实际发送失败会记录 failed/partial；可修复配置后发送测试。每条推送 TTL 为 1 小时。

| 情况                           | 实际行为                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| 应用打开                       | 新加坡日历/提醒时间检查、昨天待办、预算提示正常工作                                           |
| 应用关闭                       | 依赖后台任务和 Web Push；应用内计时器不会继续运行                                             |
| 设备离线                       | 已打开应用可查看内存中的已加载数据；新打开显示离线页；禁止写入。推送可能延迟，过 TTL 不再送达 |
| 拒绝权限/Focus 开启            | 不保证通知显示；应用内待办继续存在                                                            |
| Supabase 免费项目暂停/网络中断 | 读取或写入显示错误及重试，复盘不能假成功；在控制台恢复项目                                    |
| 更新应用                       | 新 service worker 等待，显示刷新提示；先保存表单再刷新                                        |

Service worker 仅缓存离线页、图标和静态脚本；不会缓存认证页面、API、RSC 或财务数据，不创建离线交易队列。

## 阶段 6：GitHub 与 Vercel

本任务目标仓库为 [Jian018/Mymoney](https://github.com/Jian018/Mymoney)。正常更新：

```bash
git add .
git commit -m "Update My Money"
git push origin main
```

不提交 `.env.local`、`.env.vapid.local`、service-role 私钥、密码和令牌。`.env.example` 只有配置名称和示例。ZIP 不包含依赖、构建缓存或秘密。

1. 登录 [Vercel](https://vercel.com/new)，Import Git Repository → `Jian018/Mymoney`，框架 Next.js，根目录仓库根，Node.js 22 或受支持更新版本。
2. Production 和需要的 Preview 配置上表环境变量。service-role、VAPID 私钥、CRON_SECRET 存为 Secret；`NEXT_PUBLIC_*` 是公开配置。
3. 部署，确认 Build 成功。生产域名是 `https://…vercel.app`，在 Supabase Authentication → URL Configuration 设置 Site URL；添加需要的本地/生产 redirect URL。当前应用只使用密码登录，没有开放注册流程。
4. 更改环境变量后重新部署。Cron Jobs 中确认每日任务；生产日志中检查 200/503 等状态。不要公开任务 Authorization 值。
5. HTTPS 生产域名登录，新增真实小额 MYR/SGD 收支，刷新确认持久化，再测试预算、复盘、导出和真实推送。

直接导入仓库即可使用 Vercel 的 Git 部署，不需要额外付费 API。若没有 Vercel/Supabase 已授权账号或环境，代码完成不代表云服务已配置；必须按上面步骤完成。

### iPhone 16 Pro Max 安装

1. Safari 打开 HTTPS 生产域名。
2. Share（分享）→ Add to Home Screen（添加到主屏幕）→ Add（添加）。
3. 从主屏幕图标启动，检查没有 Safari 地址栏。
4. 登录后打开通知设置，点击允许，再做推送测试。
5. 真机检查 Dynamic Island、Home Indicator、键盘、滚动范围、返回前台复盘提醒，详见 `docs/ACCEPTANCE.md`。

## 项目结构

```text
src/app/                     根布局、登录、错误/加载页
src/app/api/data/            受保护数据读取（分页读取全部记录）
src/app/api/records/         校验后的 CRUD、复盘、预算和设置
src/app/api/push/            订阅/关闭以及真实推送测试
src/app/api/cron/reminders/  受保护的每日推送任务
src/components/             iPhone 界面、弹层、PWA/键盘处理
src/lib/                    精确金额、校验、Supabase、Web Push
src/proxy.ts                Supabase Cookie 会话刷新
public/                     Manifest、SW、离线页、真实图标
supabase/                   SQL 迁移、唯一 owner 初始化
scripts/                    图标和 VAPID 密钥生成
tests/                      金额/校验/CSV 与 PostgreSQL RLS 测试
docs/                       验收清单和实际验证记录
```

全部源文件在仓库中，可直接审阅。依赖采用安装时兼容的版本并提交 `package-lock.json`。[Next.js 安装要求](https://nextjs.org/docs/app/getting-started/installation)、[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs)、[iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)可用于核对平台要求。

生产就绪必须完成真实 Supabase、生产部署和 iPhone 验收。本地单元/数据库引擎测试不替代真实云端 Auth、PostgREST 或 iOS 测试。
