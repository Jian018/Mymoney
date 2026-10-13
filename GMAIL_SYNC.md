# Gmail Expense Sync — 配置、部署与验证

本版本修改现有项目，没有重建应用。默认首页恢复 Dashboard。Supabase 匿名设备会话和私人设备审批保持不变，Google 仅用于连接 Gmail。没有真实授权 Gmail 数据的测试结果；单元、数据库和受控界面测试不能证明线上 Gmail 同步成功。

## 1. 先执行数据库迁移

在 Supabase → SQL Editor 执行 `supabase/migrations/004_gmail_expense_sync.sql`，一次即可。它要求 001、002、003 已执行。如果只执行了 001 和 002，先执行 003，再执行 004；不要重复运行已完成的迁移。新项目按 001 → 002 → 003 → 004 初始化，并继续使用 `supabase/setup-device.sql` 审批设备。

004 新增四个用户数据表：`gmail_connections`、`gmail_processed_messages`、`gmail_sync_runs`、`gmail_import_candidates`。它还新增私有 `gmail_private_tokens`、`gmail_oauth_states` 和金额以文本返回的查询视图。

所有新表开启 RLS。已批准设备只能读取其账本数据；不能直接修改邮件导入表。扫描 RPC 只授予服务角色，由验证过设备身份的 Next.js 后端调用。审核和断开 RPC 校验当前设备的账本归属。令牌表及 OAuth state 表不向浏览器角色授予读取权限。密文使用 AES-256-GCM，绑定账本、Google 账户和连接 ID；密钥仅保存在 Vercel 服务端。

迁移保留旧 transactions/import_batches/import_items，撤销旧 provider 写入授权。历史 SQL 003 作为迁移依赖保留，不重新开放旧 Auto Import。原有手动 Cash、预算、打卡、提醒、推送、报表和 CSV 继续使用现有表。

## 2. Google Cloud Console

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择自己的项目。
2. APIs & Services → Library，启用 **Gmail API**。
3. Google Auth Platform（或 OAuth consent screen）→ Branding：填写 My Money、真实支持邮箱、开发者邮箱、主页 URL、隐私政策 URL `https://你的正式域名/gmail-privacy`。设置 `APP_SUPPORT_EMAIL` 后该页面显示你的联系方式。对公开发布需准备准确的品牌/隐私内容和域名所有权证明。
4. Audience：个人 Gmail 选择 **External**，先用 **Testing**，在 Test users 添加自己的 Gmail 地址。不要把个人 Gmail 当作 Workspace Internal 用户。
5. Data Access：添加 `https://www.googleapis.com/auth/gmail.readonly`。应用另请求 `openid` 和 `email` 用来验证 Google 账户并显示地址；不请求 Gmail send/modify/delete，也不请求 profile。
6. Clients → Create client → **Web application**。Authorized redirect URIs 必须精确填写：

   ```text
   https://你的正式域名/api/gmail/callback
   ```

   域名、协议、路径必须与 `APP_URL` 一致，不支持通配回调。使用稳定的生产域名；预览部署不要复用生产 Gmail 密钥或生产账本。所有生产访问使用 HTTPS。

7. 将 Client ID 和 Client secret 放到 Vercel 的服务器环境变量。不要发到聊天、提交 Git，或使用 `NEXT_PUBLIC_` 前缀。

这是官方 Google Web Server OAuth 流程：明确点击 → Google consent → 一次性 state / PKCE / OIDC nonce 校验 → 服务端交换 code → 账户关联到现有 Supabase 账本 → 密文存储。HTTP-only SameSite state cookie 与数据库 state 同时绑定当前设备。成功回调只连接 Gmail，**不会扫描**；回到 Dashboard 后再按 Retrieve Email Data 开始扫描。[Google OAuth 文档](https://developers.google.com/identity/protocols/oauth2/web-server)

### Restricted scope 的部署限制

`gmail.readonly` 是 restricted scope。个人使用和开发测试可能符合 Google 的验证例外，但仍须遵守用户数据政策；不能因项目叫“个人应用”就假定所有公开用途都豁免。无适用例外时，正式上线需要 restricted-scope verification。本实现会在 Vercel 服务端处理 Gmail 数据并在 Supabase 保留选定交易证据；适用验证要求的服务器端应用通常需要第三方安全评估，且须按 Google 的要求复评。请在公开推广前确定自己的适用范围和评估义务。[Scope 分类](https://developers.google.com/workspace/gmail/api/auth/scopes)、[验证要求和例外](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

External Testing 只允许指定测试用户，会出现未验证警告并有用户上限。带 Gmail 权限的 Testing refresh token 通常 **7 天过期**，需要重新连接；上线到 Production 并不自动等于验证通过。管理员策略或用户撤销也可能阻断访问。[Google token 生命周期](https://developers.google.com/identity/protocols/oauth2)

## 3. Vercel 环境变量

Vercel → 项目 → Settings → Environment Variables，在实际使用的 **Production** 环境设置：

| 变量                                   | 内容                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | 原有 Supabase 项目 URL                                          |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 原有 publishable key                                            |
| `ALLOWED_USER_ID`                      | 原有稳定账本 owner UUID，不是新建 Google 账户 ID                |
| `SUPABASE_SERVICE_ROLE_KEY`            | Supabase 服务角色密钥，仅服务器使用                             |
| `APP_URL`                              | 正式 HTTPS origin，例如 `https://mymoney.example.com`，不带路径 |
| `GOOGLE_CLIENT_ID`                     | Web application OAuth Client ID                                 |
| `GOOGLE_CLIENT_SECRET`                 | 该 OAuth client 的 secret                                       |
| `GMAIL_TOKEN_ENCRYPTION_KEY`           | 随机 32 字节的 base64 字符串                                    |
| `APP_SUPPORT_EMAIL`                    | 真实联系邮箱，公开隐私页面使用                                  |

生成加密密钥（本机运行，输出只放 Vercel）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

保留原 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`、`CRON_SECRET`。不再需要 `PAYPAL_*`。生产密钥变更需 Redeploy；保持加密密钥稳定，直接替换它会使已有密文不可读，需要重新连接 Gmail。代码不会将 OAuth client secret、服务角色密钥或 Gmail tokens 返回前端。备份/轮换由项目 owner 管理，数据库备份与密钥应分别保护。

## 4. 部署顺序

1. 备份数据库，执行缺少的迁移。
2. 完成 Google Cloud 设置和 Vercel 环境变量。
3. 使用本次 GitHub main 提交部署 / Redeploy。Next.js Node route 的 `maxDuration=300`；扫描会在约 210 秒或 200 封新候选邮件后安全结束为 Partial。确认你的 Vercel 计划允许配置时长；更短超时会保留已提交结果，五分钟 lease 后可再次手动继续。
4. 用已批准设备打开正式 HTTPS 地址；Dashboard 显示 Gmail 卡片。
5. 点击 Retrieve Email Data → Google 同意 → 返回 → 卡片显示地址 → 再点击 Retrieve Email Data。

iOS standalone PWA 与 Safari 可能使用不同会话。OAuth 回调必须带原 Supabase 设备会话和 state cookie；如果系统把授权打开到未批准的 Safari 会话，严格校验会拒绝回调。请在同一已批准的浏览器完成连接，再回到 PWA。必要时按原 `setup-device.sql` 流程将 Safari 的 Device ID 也批准到**同一账本**，随后在 Safari 发起并完成授权。不要关闭 state 校验或用 URL 传递 Supabase/Gmail tokens。真机回调/主屏幕行为需要实际验证，受控浏览器测试不能代替 iPhone。

## 5. 扫描与判定

- 仅 POST `/api/gmail/sync` 扫描，要求已批准 Supabase 会话和同源 Origin。打开页面、GET 状态、定时状态轮询不会读取 Gmail。
- 窗口是按钮按下时刻之前滚动 **168 小时**。`messages.list` 用 epoch 时间和目标域名/财务标题关键词搜索，处理 `nextPageToken`；`messages.get(metadata)` 检查真实标题、接收 internalDate，再按需 `messages.get(full)`。不扫描 spam/trash/sent，不下载附件。较大邮件或无法解释的邮件计入失败，可重试。
- DBS/POSB/Public Bank/Grab/Shopee/Taobao/TNG 使用可扩展的 `providers.ts` 规则注册表。域名和 Google DMARC 结果用于保守判断，银行邮件还须包含实际卡消费上下文。来源名称不代表该机构一定发送收据或其所有模板均已支持。
- MIME plain text/HTML 在服务器处理（目前 UTF-8 正文）；不向外部 AI 发送邮件，不保存完整正文/附件，不记录邮件内容或 tokens。保存选定元数据、金额候选和正文 hash，便于核对原 Gmail。
- 自动保存要求：已认证已知来源、明确成功消费措辞、明确商户/交易日期/支付金额、唯一正金额、明确 MYR/SGD、无条件/否定/收入措辞、无疑似重复。其余进入审核，或者作为无有效金额/非消费处理。规则并非银行账户流水，不能恢复未收到的收据；实际模板需用脱敏样本扩展并测试。
- SGD/S$、MYR/RM 使用十进制文本和 bigint cents；PostgreSQL numeric 保留精度。孤立 `$`、多金额、多币种和外国币种进入审核，没有自动换汇。外币原始金额保存在选定证据中，必须核对实际 MYR/SGD 卡结算后才能批准。
- 类别为 Food/Transport/Shopping/Groceries/Bills/Entertainment/Travel/Other；用户分类保留。没有商户专属证据时采用来源类别或 Other，后续可在 Gmail 审核中改类别。
- wallet top-up、内部转账、取消和预授权不计支出；pending 不计支出且不可直接批准成已完成消费。退款必须选择原支出，不得超过未退余额；退款减少原分类/币种的支出，绝不作为新的消费或收入。取消邮件不会擅自删除已保存消费，必须确认是否有真实退款。

## 6. 去重、审核与审计

消息唯一键 `(user_id,google_account_id,gmail_message_id)`；来源编号按来源/状态 namespace hash；Gmail transactions 有部分唯一索引 `(user_id,source_transaction_id)`。同消息/同来源参考号的相容金额币种日期直接链接已保存记录。冲突编号进入审核。无编号退回账户+消息 ID，另比较已有所有来源交易和 Cash。

跨银行/钱包/购物平台比较日期 ±3 天的同币种同金额，或相同规范商户/参考号；商户或参考号匹配也会检查跨币种记录。只凭同金额并不能证明重复，因此进入 Pending Review，避免 RM89.90 被算成 RM179.80。审核可：修正金额币种商户日期/分类 → 明确批准；链接已有交易为重复；匹配真实退款；拒绝。若可能重复，另记一笔必须勾选已核对单独购买/退款。审核时再次查数据库，防止两个待审邮件先后被算两次。相同编号永远不能用“另记一笔”绕过唯一约束。外币卡结算与购物收据可能币种和金额不同，仍须审核；确认同一购买后，勾选外币结算确认并链接已有支出。已有支出的金额和币种保持不变，不换汇、不增加支出。退款必须与原支出使用同一币种。

每封邮件结果与一笔财务写入处于同一数据库事务；owner advisory lock 与 Cash 写入共享。扫描有 request UUID 幂等、每 owner 一个 active run、五分钟 lease 和 connection revision 校验；断开/换账户立即使旧 run 失效。扫描中断保留已确认数据，显示 Failed/Partial，不声称七天都已完成。再次手动扫描跳过已处理消息。

Dashboard 预算/报表用原有交易聚合，刷新后纳入已保存消费，Pending Review 不纳入。卡片显示该次扫描统计和独立 MYR/SGD 新支出；历史 run 的统计保持当次事实，后续审核不会重写当次“自动保存”数量。已处理旧邮件在重扫中计为 duplicate skip（包含以前忽略的邮件），并非又生成新的 transaction。待审与已保存消费均可分页加载以审核或修改分类；最近 30 条其它审计证据在卡片显示。完整已保存交易仍可在 Transactions / CSV 查看，CSV 新增 Gmail message、Google account、reference、source provider 列；source=gmail 标明导入通道，source_provider 保留原机构/平台。

Disconnect 删除本地密文、清除未完成 OAuth 状态、取消 run，并请求 Google revoke。若远端失败，界面提示在 [Google Account Permissions](https://myaccount.google.com/permissions) 手动撤销；原消费/证据不删除。用户可由项目 owner 处理数据删除请求，不借断开连接删除财务记录。

## 7. 文件结构变更

```text
src/lib/gmail/
  types.ts       # 连接、候选、run 类型
  providers.ts   # 可扩展真实邮件规则，非银行连接适配器
  parser.ts      # MIME、sender、状态、日期、金额、商户、分类
  crypto.ts      # AES-GCM、state hash、constant-time equality
  server.ts      # 官方 OAuth client、私有 DB、token refresh、Gmail GET
  sync.ts        # 168 小时搜索、分页、按需读取、RPC 保存、失败恢复
src/app/api/gmail/
  route.ts       # 安全状态/审核结果 GET
  authorize/route.ts
  callback/route.ts
  sync/route.ts
  review/route.ts
  candidates/route.ts # 待审/已保存分页
  disconnect/route.ts
src/components/gmail-sync.tsx
src/components/money-app.tsx # Home 默认 Dashboard，保留导航
src/app/globals.css         # 固定根视口，内部原 content 滚动
src/app/gmail-privacy/page.tsx
src/proxy.ts                # Gmail API Supabase 会话刷新
src/lib/finance.ts          # CSV 保留 Gmail 来源元数据
supabase/migrations/004_gmail_expense_sync.sql
tests/gmail.test.ts
.env.example
package.json / package-lock.json
README.md / GMAIL_SYNC.md
```

移除 `src/components/auto-import.tsx`、`src/app/api/imports/*`、`src/lib/import/*`、旧 import 测试、CSV 导入模板和 AUTO_IMPORT.md。001–003 历史迁移与已有数据库记录保留。

## 8. 验证步骤

```bash
npm ci
npm run typecheck
npm test
npm run build
```

`tests/gmail.test.ts` 的邮件样本是明确标识的人工 fixture。测试范围：plain/HTML/中文、币种歧义/精度、伪 sender、非消费事件、密文认证、真实 PostgreSQL 引擎中的迁移、RLS、唯一约束、幂等/并发 lease、跨平台审核、退款、分类修改、原历史记录保留和 disconnect。它们不是 Gmail API 实际授权测试。

配置后必须进行真实接受测试：

1. 记录数据库当前消费数量和两个币种余额。只打开 Dashboard，确认没有新的 gmail_sync_runs，也没有读取邮箱。
2. 用 Google 测试用户授权；检查真实 Google consent 只要求只读 Gmail 和账户识别。浏览器网络响应不能包含 access/refresh tokens。
3. 按 Retrieve，在自己的真实七天邮件中逐条对照来源、金额、币种、付款状态、日期；没有收据必须显示空结果而非生成数据。
4. 确认 sources 同一购买的邮件只保存一笔，其余进入审核或精确 duplicate；重复按 Retrieve，transactions 数量不增加。核对 manual Cash 同笔不会双计。
5. 审核歧义 `$`、外币结算、多金额、未知日期、同日同额不同商户，只有显式修正/批准后纳入；退款匹配原支出并核对预算/报表。
6. 测试断开 Google / Google Account 撤销授权、Testing token 过期、网络失败和函数超时。界面必须要求重连或报告 Partial/Failed，不能伪装完整扫描。
7. 真 iPhone 16 Pro Max 主屏幕启动：440×956 目标尺寸，根视口不滚动/横移、底部导航固定、Dynamic Island/safe areas、展开长审核内容可内部滚动、金额键盘出现后按钮仍可滚动到。浏览器尺寸测试不等于真机验证。

上述真实 Gmail / iPhone 步骤完成前，不应把模块描述为已通过真实邮箱验证。配置错误只影响 Gmail 功能，不要求更换现有账本或重新录入数据。
