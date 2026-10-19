# Prompt 私人工作台

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

需要 Node.js 22.18 以上和 npm。Cloudflare CLI 已包含在开发依赖中。

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

本项目使用 `cf` CLI 和 `cloudflare.config.ts`。首先登录：

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

Worker 需要三个 Secret：

| Secret | 内容 |
| --- | --- |
| `ACCESS_PASSWORD_HASH` | 高熵访问口令的 SHA-256 十六进制摘要 |
| `SESSION_SECRET` | 至少 32 字节安全随机数据生成的会话签名密钥 |
| `DATA_KEY` | 32 字节安全随机 AES 密钥的 Base64 编码 |

首次部署时，在本机创建被 Git 忽略的 `.env.production.secrets` 文件，填入上述三个 Secret（`名称=值`，一行一个），再执行：

```sh
npm run build
npx cf deploy --secrets-file .env.production.secrets
```

R2 桶与 Durable Object 由 CLI 按配置创建或绑定；账号需要开通 R2。之后常规更新使用 `npm run deploy`，会先重新构建前端。直接调用 `cf deploy` 时，应先运行 `npm run build`。

**更新现有部署时，请继续使用原账号、Worker、R2 桶和自定义域名配置。不要替换 `DATA_KEY`。** 首次部署完成后，密钥应另行安全保管；不要加入 GitHub、Issue 或构建日志。

## 访问保护

- 未登录时，工作台页面、脚本、字体和数据接口由服务端阻止访问，仅公开登录所需资源。
- Cookie 使用 Secure、HttpOnly、SameSite=Strict；会话最长有效期为 12 小时。
- 15 分钟内输错 5 次，封禁来源 IP 15 分钟；重复触发指数延长，最多 24 小时。登录成功清零此 IP 的累计惩罚。
- 使用 Cloudflare 提供的 `CF-Connecting-IP`，不信任客户端转发的 `X-Forwarded-For`。
- 修改密码摘要会使现有会话失效；退出立即撤销当前会话。
- ETag 条件写入防止多设备直接覆盖彼此的修改；冲突时可先导出本机内容再读取云端。

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
- `src/auth-guard.mjs`、`src/ban-policy.mjs`：持久化登录失败计数与会话撤销。
- `src/workspace-store.mjs`：当前状态、100 条历史与并发条件写入。
- `src/server-crypto.mjs`：会话签名和 AES-GCM 加密。
- `public/`：页面、登录和样式。
- `tests/`：变量、加密、访问控制、IP 封禁、备份及历史恢复测试。

`dist/`、`src/assets.generated.mjs`、本机配置、凭据和测试存储均不应提交。构建时会重新生成前端资源；请不要把个人工作区备份放进仓库。
