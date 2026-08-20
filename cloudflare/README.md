# QuickShare Cloudflare

这是 QuickShare 的 Cloudflare 原生版：Worker 负责 API、管理控制台和 Host 路由，D1 保存站点发布元数据，R2 保存版本化静态文件。

## 一键部署到 Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gzsteven666/quickshare/tree/main/cloudflare)

点击按钮后，Cloudflare 会从 `cloudflare/` 子目录创建 Worker，并按 `wrangler.jsonc` 自动准备 D1 和 R2。首次部署使用 `workers.dev`，不需要预先配置自定义域名。

部署向导会要求填写两个 Worker Secret：

- `ADMIN_PASSWORD`：管理后台登录密码。
- `COOKIE_SIGNING_KEY`：至少 32 字节的随机字符串，用于签名会话 Cookie。不要复用管理员密码。

部署完成后打开 Worker 的 `workers.dev` 地址，输入管理员密码即可拖入 ZIP 发布。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run typecheck
npm test
npm run db:migrate:local
npm run dev
```

PowerShell 可以使用：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

本地控制台默认使用测试 Wrangler 配置中的 `quickshare.test` 主机。只需要在 `.dev.vars` 中替换两个 Secret；D1 和 R2 的本地绑定由 Vitest/Wrangler 管理。

## 发布流程

1. 登录管理控制台。
2. 拖入包含 `index.html` 的 ZIP。
3. 浏览器读取 ZIP central directory，校验路径、文件数量、单文件大小、总大小和入口文件。
4. Worker 创建上传版本；浏览器以最多 4 路并发逐文件 PUT 到 R2。
5. 全部文件写入后，D1 原子切换 `current_version_id`。
6. 通过返回的 `/s/<siteId>/` 预览地址打开站点。

首版限制：最多 500 个文件、单文件 8 MB、单站点 30 MB。ZIP 内只允许静态文件，不执行 Node、PHP 或 Python 服务端代码。

## 自定义域名

控制台可以记录一个域名到站点的映射，但不会保存 Cloudflare API Token，也不会自动修改 DNS。添加映射后按界面指引在 Cloudflare Dashboard 完成一次绑定：

- 泛域名方案：创建 proxied `*.sites.example.com` DNS，并添加 `*.sites.example.com/*` Worker Route。
- 精确域名方案：在 Worker 的 Domains & Routes 中添加精确 Custom Domain。

之后 Worker 会通过 D1 的 `domains.hostname` 查找站点，并从当前发布版本读取 R2 对象。

## 常用命令

```bash
npm run typecheck          # TypeScript 检查
npm test                   # Vitest + Cloudflare Workers 测试池
npm run db:migrate:local   # 应用本地 D1 迁移
npm run db:migrate:remote  # 应用远程 D1 迁移
npm run accept:zip -- path/to/site.zip  # 用真实 ZIP 做本地端到端验收
npm run deploy             # 远程迁移后部署 Worker
```

`deploy` 脚本使用 D1 binding 名称 `DB`，这样一键部署创建的数据库 ID 被 Cloudflare 写回配置后仍能正确迁移。

真实 ZIP 验收前先运行 `npm run db:migrate:local` 和 `npm run dev`，然后执行 `npm run accept:zip -- "C:\\path\\site.zip" http://127.0.0.1:8799`。脚本会登录、创建清单、逐文件上传、原子发布，并检查预览 HTML、CSP 和 CSS 资源。

## 目录

```text
cloudflare/
├─ public/                 # 控制台、Zip.js 浏览器资源
├─ src/                    # Worker、API、R2 响应和 D1 repositories
├─ migrations/             # D1 migrations
├─ test/                   # Worker、D1、R2、域名和 ZIP 清单测试
├─ wrangler.jsonc          # Worker + D1 + R2 + workers.dev
└─ .dev.vars.example       # 本地 Secret 示例
```

根目录 Express 版本与此 Cloudflare 版本相互隔离；Deploy button 的入口固定指向本目录。
