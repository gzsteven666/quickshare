# QuickShare Cloudflare

Cloudflare 原生版本：Worker + Workers Static Assets + D1 + R2。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run typecheck
npm test
npm run dev
```

## 资源

- D1 binding：`DB`
- R2 binding：`SITES`
- Static Assets binding：`ASSETS`

目前 Worker 只提供健康检查和静态控制台壳；ZIP 解压、分文件上传、发布版本和站点路由按实施计划逐步接入。
