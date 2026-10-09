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

Windows PowerShell 用 `Copy-Item .env.example .env.local` 代替 `cp`。打开 http://localhost:3000。没有邮箱、密码或 Google 登录页。首次批准设备后自动进入；未批准的设备不能查看账本。图标已包含在仓库；`npm run icons` 可以重新生成。

```bash
npm run typecheck
npm test
npm run build
npm start
```

## 阶段 2：Supabase 与私人设备绑定

此版本已移除 `/login` 和邮箱密码表单。使用 Supabase 匿名会话识别浏览器安装，并由你在 Supabase SQL Editor 手动批准。它是对浏览器会话的授权，不是不可复制的硬件身份。

1. 创建免费 Supabase 项目。SQL Editor 按顺序执行 `supabase/migrations/001_initial.sql` 和 `002_device_access.sql`，每个只执行一次。**如果你已经执行过 001，只执行 002，不要重复初始化。**
2. 初次绑定期间，在 Authentication → Sign In / Providers 开启 **Allow anonymous sign-ins**，并允许创建新用户（Allow new users to sign up）。不需要 Google、Gmail、邮箱或密码；可以关闭 Email 和所有不需要的登录提供商。匿名会话没有财务访问权限，必须另行批准。
3. 在 Project Settings / Connect 中取得项目 URL 和 publishable key。将这两项先填入 Vercel 的 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，先部署。此时 `ALLOWED_USER_ID` 可以暂时留空，应用显示设备设置页，不公开任何账本数据。
4. Safari 打开你的 HTTPS 域名 → 分享 → 添加到主屏幕。**从主屏幕图标启动后**点击 **Bind this device**，复制页面上的 Device ID。Safari 与主屏幕安装可能使用不同会话，因此先安装再绑定。
5. 在 Supabase SQL Editor 打开 `supabase/setup-device.sql`，用刚复制的 Device ID 替换全零 UUID，执行。脚本自动初始化第一个私人账本和默认分类，或将设备授权到已有账本；不会删除或迁移已有财务记录。最后会返回 `ALLOWED_USER_ID`。
6. 将返回的 `ALLOWED_USER_ID` 添加到 Vercel 环境变量，再重新部署。它是**账本拥有者**编号；更换设备时保持不变，不一定等于新设备编号。
7. 回到主屏幕应用，点击 **I’ve approved this device · Check access** 或刷新。之后已批准且保有会话的安装直接进入应用。新增 MYR/SGD 记录后刷新，确认真实持久保存。
8. 完成绑定后，可以关闭 **Allow new users to sign up**，减少未经批准设备创建匿名账号。已有会话继续使用；以后需要绑定新安装时临时重新开启。

所有凭据只填写到你自己的本地 `.env.local` 或 Vercel 环境变量，不发送到聊天。没有公开的设备授权写入接口；浏览器不能自行修改 `authorized_devices`。

| 变量                                   | 用途                                                  | 是否可在浏览器出现 |
| -------------------------------------- | ----------------------------------------------------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | 项目 HTTPS URL                                        | 是                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable 或旧 anon key，受 RLS 限制                | 是                 |
| `ALLOWED_USER_ID`                      | setup-device.sql 返回的账本 owner UUID                | 服务器读取         |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Web Push 公钥                                         | 是                 |
| `VAPID_PRIVATE_KEY`                    | Web Push 私钥                                         | **否**             |
| `VAPID_SUBJECT`                        | `mailto:你的邮箱`，仅是推送服务联系方式，不是应用登录 | 服务器读取         |
| `SUPABASE_SERVICE_ROLE_KEY`            | 仅每日任务使用，绕过 RLS                              | **否**             |
| `CRON_SECRET`                          | 长随机字符串，保护每日任务                            | **否**             |

数据库 RLS 使用 `current_owner_id()` 将已批准的设备会话映射到单一 `app_owner`。所有财务记录继续保存账本 owner ID；未知设备和匿名未认证请求不能读取或修改。预算分类、交易类型和金额约束保持有效，金额仍用 `NUMERIC(14,2)` + `BigInt` 分计算。

### 重装、会话丢失与撤销访问

清除 Cookie、重装、换浏览器或会话失效后，旧匿名会话不能通过邮箱密码找回。临时允许匿名账号创建，用新安装生成 Device ID，再运行 `setup-device.sql` 批准新编号；原账本和 `ALLOWED_USER_ID` 保持不变。

**不要删除 `app_owner.user_id` 指向的 Supabase Auth 用户**：它仍是账本的持久拥有者，删除会触发外键级联。会话丢失不等于删除服务器用户。

如要撤销某个安装，在 SQL Editor 执行下面语句（替换为实际旧设备编号）：

```sql
delete from public.authorized_devices
where device_user_id = 'OLD_DEVICE_UUID';
```

该会话会立即失去数据库权限；已显示在设备内存中的内容在刷新后消失。此操作不删除交易。若只是想恢复访问，批准新设备即可，不需要先撤销旧设备。

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

`/api/push` 和 `/api/push/test` 需要已批准的设备会话及同源请求；服务端按允许的推送提供商验证 endpoint。`/api/cron/reminders` 使用 `CRON_SECRET`，只向配置的单个 owner 发送。密钥仅通过服务器环境读取。点击通知会打开复盘页面。

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
3. 部署，确认 Build 成功。生产域名是 `https://…vercel.app`。将它设为 Supabase Authentication → URL Configuration 的 Site URL。当前版本不使用邮箱或 OAuth 回调；设备批准期间需要允许匿名会话创建。
4. 更改环境变量后重新部署。Cron Jobs 中确认每日任务；生产日志中检查 200/503 等状态。不要公开任务 Authorization 值。
5. 从已批准的主屏幕安装打开 HTTPS 生产域名，新增真实小额 MYR/SGD 收支，刷新确认持久化，再测试预算、复盘、导出和真实推送。

直接导入仓库即可使用 Vercel 的 Git 部署，不需要额外付费 API。若没有 Vercel/Supabase 已授权账号或环境，代码完成不代表云服务已配置；必须按上面步骤完成。

### iPhone 16 Pro Max 安装

1. Safari 打开 HTTPS 生产域名。
2. Share（分享）→ Add to Home Screen（添加到主屏幕）→ Add（添加）。
3. 从主屏幕图标启动，检查没有 Safari 地址栏；按阶段 2 批准此安装的 Device ID。
4. 设备已批准并自动进入后，打开通知设置，点击允许，再做推送测试。
5. 真机检查 Dynamic Island、Home Indicator、键盘、滚动范围、返回前台复盘提醒，详见 `docs/ACCEPTANCE.md`。

## 项目结构

```text
src/app/                     根布局、设备设置、错误/加载页
src/app/api/device/          当前设备会话状态（不返回财务数据）
src/app/api/data/            受保护数据读取（分页读取全部记录）
src/app/api/records/         校验后的 CRUD、复盘、预算和设置
src/app/api/push/            订阅/关闭以及真实推送测试
src/app/api/cron/reminders/  受保护的每日推送任务
src/components/             iPhone 界面、弹层、PWA/键盘处理
src/lib/                    精确金额、校验、Supabase、Web Push
src/proxy.ts                Supabase Cookie 会话刷新
public/                     Manifest、SW、离线页、真实图标
supabase/                   两个 SQL 迁移、私人设备批准与 owner 初始化
scripts/                    图标和 VAPID 密钥生成
tests/                      金额/校验/CSV 与 PostgreSQL RLS 测试
docs/                       验收清单和实际验证记录
```

全部源文件在仓库中，可直接审阅。依赖采用安装时兼容的版本并提交 `package-lock.json`。[Next.js 安装要求](https://nextjs.org/docs/app/getting-started/installation)、[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs)、[Supabase 匿名会话](https://supabase.com/docs/guides/auth/auth-anonymous)、[iOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)可用于核对平台要求。

生产就绪必须完成真实 Supabase、生产部署和 iPhone 验收。本地单元/数据库引擎测试不替代真实云端 Auth、PostgREST 或 iOS 测试。
