# Prompt 私人工作台

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/0511150/prompt-manager)

点击按钮，将应用部署到你自己的 Cloudflare 账号；需要先开通 R2。部署页面填写至少 24 字符、独一无二的随机 `SETUP_TOKEN` 初始化码。部署完成后打开网站，凭初始化码设置访问密码（至少 12 字符）。初始化码不等于访问密码，切勿使用公开的示例值。

一键部署读取 `wrangler.jsonc`，默认部署命令为 `npm run deploy`；资源由 Cloudflare 创建和绑定。网站密码只保存 PBKDF2-SHA-256 加盐校验结果，会话密钥和数据加密密钥自动生成并持久化到 `AccessControl`。首次设置只能成功一次，并发提交也不能覆盖已设置的密码。

基于 Cloudflare Workers、R2 和 Durable Objects 的单用户 Prompt 管理器。

## 功能

- 嵌套文件夹、文档标签页、New Tab，以及独立的收藏文件夹。
- 直接编辑 Markdown，支持预览、左右对照及 LaTeX 公式。
- 使用 `@@变量名@@` 编写模板；预览自动替换变量，“复制成品”复制完整结果。
- 保存常用变量组合并一键填入。
- 文件夹支持右键菜单、重命名、移动和子文件夹。
- 统一访问密码、12 小时登录会话、退出撤销、持久化 IP 失败封禁。
- R2 加密保存当前工作区和最近 100 个旧状态，可在设置中预览、恢复。
- 备份下载到本机，导入从本机选择文件。

只有一个私人工作区，没有注册或多空间入口。格式语法直接手写，不提供格式插入工具栏。

## 本机开发

需要 Node.js 22.18 以上和 npm。Cloudflare CLI、Wrangler 和 Miniflare 已包含在开发依赖中。

```sh
npm ci
npm run setup:dev
npm run dev
```

打开 `http://127.0.0.1:8787/`。本机测试密码是 `local-integration-password-only`，只适用于本机测试。

`setup:dev` 仅在 `.dev.vars` 不存在时生成测试凭据，已有文件不会被覆盖。不要将真实生产密钥放进本机测试配置。

保持开发服务运行，在另一个终端执行：

```sh
npm test
npm audit --omit=dev
```

集成测试连接本机 Workers 运行时及模拟存储，不得对生产工作区运行。GitHub Actions 自动执行同样的构建、依赖检查和测试。

## 部署到 Cloudflare

一键部署和新部署使用 `wrangler.jsonc`（不含个人账号或域名）。按钮中的部署流程会要求 `SETUP_TOKEN`；也可以先通过 `npx wrangler secret put SETUP_TOKEN` 设置初始化码后部署。

现有基于 cf 的部署仍使用 `cloudflare.config.ts`，其更新命令为 `npm run deploy:cf`。继续更新旧部署前先登录：

```sh
npx cf auth login
```

部署参数通过环境变量提供，仓库不包含个人账号或域名：

| 环境变量 | 用途 | 默认值 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare 账号 | 由 CLI 的登录账号选择 |
| `CLOUDFLARE_WORKER_NAME` | Worker 名称 | `prompt-manager` |
| `CLOUDFLARE_R2_BUCKET` | R2 桶名称 | `prompt-manager-vaults` |
| `CLOUDFLARE_CUSTOM_DOMAIN` | 可选自定义域名，所属区域须位于目标账号 | 不绑定，使用 workers.dev |

PowerShell 示例（把占位符换成自己的值）：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID='YOUR_ACCOUNT_ID'
$env:CLOUDFLARE_CUSTOM_DOMAIN='prompt.example.com'
npm run build
npx cf deploy --dry-run
```

以下配置仅用于兼容旧版部署；一键部署的新用户无需手动生成这三个 Secret：

| Secret | 内容 |
| --- | --- |
| `ACCESS_PASSWORD_HASH` | 高熵访问口令的 SHA-256 十六进制摘要 |
| `SESSION_SECRET` | 至少 32 字节安全随机数据生成的会话签名密钥 |
| `DATA_KEY` | 32 字节安全随机 AES 密钥的 Base64 编码 |

维护旧版部署时，可在本机创建被 Git 忽略的 `.env.production.secrets` 文件，填入上述三个 Secret（`名称=值`，一行一个），再执行：

```sh
npm run build
npx cf deploy --secrets-file .env.production.secrets
```

R2 桶与 Durable Object 由 CLI 按配置创建或绑定；账号需要开通 R2。旧部署常规更新使用 `npm run deploy:cf`，会先重新构建前端。新部署使用 `npm run deploy`，由 Wrangler 的构建步骤生成资源。直接调用 `cf deploy` 时，应先运行 `npm run build`。

**更新现有部署时，请继续使用原账号、Worker、R2 桶和自定义域名配置。不要替换 `DATA_KEY`。** 首次部署完成后，密钥应另行安全保管；不要加入 GitHub、Issue 或构建日志。

## 访问保护

- 未登录时，工作台页面、脚本、字体和数据接口由服务端阻止访问，仅公开登录所需资源。
- Cookie 使用 Secure、HttpOnly、SameSite=Strict；会话最长有效期为 12 小时。
- 15 分钟内输错 5 次，临时封禁来源 IP 15 分钟，每次时长固定。滚动 24 小时内第 5 次触发封禁，转为永久封禁。永久封禁需管理员从其他 IP 或白名单 IP 登录后手动解除。成功登录清空该 IP 的全部失败与封禁统计。
- 使用 Cloudflare 提供的 `CF-Connecting-IP`，不信任客户端转发的 `X-Forwarded-For`。
- 修改密码摘要会使现有会话失效；退出立即撤销当前会话。
- ETag 条件写入防止多设备直接覆盖彼此的修改；冲突时可先导出本机内容再读取云端。

在「设置 → 登录保护 · Fail2ban」可查看失败次数、最近 24 小时触发次数、临时/永久封禁状态，手动解除并清空记录，以及添加/移除白名单。白名单支持单个 IPv4 和 IPv6 地址，不支持通配符或网段；白名单仍须正确密码。添加白名单时会清空该 IP 的已有统计。

新部署的密码校验、会话密钥、数据密钥与封禁/白名单均保存在 SQLite Durable Object 中，不占用 R2 历史。不要删除 `AccessControl` 数据或绑定，避免丢失访问凭据与解密密钥。旧部署继续使用原有的三个 Worker Secrets，升级不会重新初始化或更换密钥。

详见 [安全说明](SECURITY.md)。服务器可解密工作区数据，本项目不提供端到端加密。

## 备份和历史

当前状态在 `workspace/current.json`；最多 100 个旧状态在 `workspace/history/`，均为加密内容。历史目录包含时间、操作类型和数量等元数据。标签切换、文件夹展开和仅更新时间变化不会消耗历史次数。

设置中的恢复会保存恢复前的状态。超过上限自动清理最旧记录；后台按小时清理写入中断遗留的临时历史候选。软件源码、构建产物和发布包不写入 R2。

手动备份通过浏览器下载到本机，使用 `DATA_KEY` 加密，只能由使用同一密钥的工作区恢复。保管好该密钥；更改访问密码无需更换数据密钥。

支持导入当前格式备份、普通 JSON 和旧版多空间加密备份。导入旧版加密文件时在本机输入其旧主密码。旧版多空间 API 不再提供。

## 源码结构

- `src/app.js`：前端交互、预览与同步。
- `src/model.js`：数据模型、验证和模板变量。
- `src/private-worker.mjs`：门禁、工作区、备份和历史 API。
- `src/access-control.mjs`：首次设置、持久化凭据、IP 封禁与白名单。
- `src/auth-guard.mjs`、`src/ban-policy.mjs`：会话撤销与封禁规则。
- `src/workspace-store.mjs`：当前状态、100 条历史与并发条件写入。
- `src/server-crypto.mjs`：会话签名和 AES-GCM 加密。
- `public/`：页面、登录和样式。
- `tests/`：变量、加密、访问控制、IP 封禁、备份及历史恢复测试。

`dist/`、`src/assets.generated.mjs`、本机配置、凭据和测试存储均不应提交。构建时会重新生成前端资源；请不要把个人工作区备份放进仓库。
