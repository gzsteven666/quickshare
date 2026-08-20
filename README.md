# HTML代码分享工具 (Express版本)

## Cloudflare 一键部署版

如果你要像 Netlify Drop 一样把静态站点 ZIP 拖进去就部署，可以直接使用独立的 Cloudflare 版本：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gzsteven666/quickshare/tree/main/cloudflare)

它使用 Workers + D1 + R2，首次部署提供 `workers.dev` 管理地址。完整配置、域名绑定和本地测试说明见 [`cloudflare/README.md`](cloudflare/README.md)。

这是一个基于Express.js开发的HTML代码分享工具，允许用户创建、分享和查看HTML代码片段。支持密码保护、会话管理和现代化的用户界面。

## 功能特点

- **HTML代码片段创建和分享**：轻松创建和分享HTML代码
- **密码保护功能**：可选择为代码片段设置密码保护
- **用户认证系统**：支持登录认证，保护创建功能
- **响应式设计**：现代化的用户界面，支持移动端
- **会话管理**：安全的会话存储和管理
- **最近页面查看**：快速访问最近创建的页面

## 技术栈

- **后端框架**：Node.js + Express.js
- **模板引擎**：EJS
- **数据库**：SQLite3
- **会话存储**：文件存储 (session-file-store)
- **其他依赖**：
  - body-parser：请求体解析
  - cors：跨域资源共享
  - crypto-js：加密功能
  - dotenv：环境变量管理
  - morgan：HTTP请求日志
  - marked：Markdown解析
  - mermaid：图表渲染

## 项目结构

```
html-go-express/
├── app.js                    # 应用程序入口文件
├── package.json              # 项目依赖和脚本
├── config.js                 # 配置文件
├── .env                      # 环境变量（需要创建）
├── config/                   # 配置目录
├── models/                   # 数据模型
│   ├── db.js                # 数据库初始化
│   └── pages.js             # 页面数据模型
├── routes/                   # 路由处理
│   └── pages.js             # 页面路由
├── views/                    # EJS模板文件
│   ├── layout.ejs           # 布局模板
│   ├── index.ejs            # 首页模板
│   ├── login.ejs            # 登录页面
│   ├── password.ejs         # 密码验证页面
│   ├── error.ejs            # 错误页面
│   └── partials/            # 模板片段
├── public/                   # 静态资源
├── middleware/               # 中间件
│   └── auth.js              # 认证中间件
├── utils/                    # 工具函数
├── scripts/                  # 脚本文件
├── db/                       # 数据库文件
├── sessions/                 # 会话文件存储
├── Dockerfile               # Docker配置
├── docker-compose.yml       # Docker Compose配置
└── README.md                # 项目说明
```

## 安装和运行

### 1. 环境要求
- Node.js 14.0+
- npm 或 yarn

### 2. 安装依赖
```bash
npm install
```

### 3. 环境配置
创建 `.env` 文件并配置以下变量：
```env
NODE_ENV=development
PORT=3000
AUTH_ENABLED=true
AUTH_PASSWORD=your_password_here
DB_PATH=./db/database.sqlite
```

### 4. 启动应用

**开发环境**（支持热重载）：
```bash
npm run dev
```

**生产环境**：
```bash
npm start
```

**测试环境**：
```bash
npm run test
```

服务器默认运行在 http://localhost:3000

### 5. Docker 部署

使用 Docker Compose：
```bash
docker-compose up -d
```

或使用 Docker：
```bash
docker build -t html-go-express .
docker run -p 8888:8888 html-go-express
```

## 使用说明

### 1. 访问应用
- 打开浏览器访问 http://localhost:3000
- 如果启用了认证，需要先登录

### 2. 创建HTML页面
1. 在首页的编辑器中输入HTML代码
2. 选择是否设置密码保护
3. 点击"创建分享链接"按钮
4. 获得分享链接，可以分享给其他人

### 3. 查看分享的页面
- 通过分享链接访问页面
- 如果设置了密码保护，需要输入密码才能查看

## API接口

### 1. 创建页面
- **路径**：`POST /api/pages/create`
- **功能**：创建新的HTML页面
- **认证**：需要登录
- **参数**：
  ```json
  {
    "htmlContent": "HTML代码内容",
    "isProtected": true/false
  }
  ```
- **返回**：
  ```json
  {
    "success": true,
    "urlId": "页面ID",
    "password": "密码（如果设置了保护）",
    "isProtected": true/false
  }
  ```

### 2. 获取页面
- **路径**：`GET /api/pages/:id`
- **功能**：获取指定ID的页面内容
- **参数**：
  - `id`: 页面ID
  - `password`: 密码（如果页面受保护）

### 3. 获取最近页面
- **路径**：`GET /api/pages/recent`
- **功能**：获取最近创建的页面列表
- **认证**：需要登录

## 配置选项

在 `config.js` 中可以配置：

- `port`: 服务器端口
- `authEnabled`: 是否启用认证
- `authPassword`: 登录密码
- `dbPath`: 数据库文件路径
- `logLevel`: 日志级别

## 安全特性

- **会话管理**：使用文件存储的安全会话
- **密码保护**：支持为页面设置访问密码
- **认证系统**：保护页面创建功能
- **CORS支持**：安全的跨域请求处理
- **输入验证**：防止恶意输入

## 开发和部署

### 开发模式
```bash
npm run dev
```
使用 nodemon 自动重启，便于开发调试。

### 生产部署
1. 设置环境变量 `NODE_ENV=production`
2. 配置正确的端口和认证信息
3. 使用 `npm start` 启动应用
4. 建议使用 PM2 或 Docker 进行进程管理

### Docker 部署
项目包含完整的 Docker 配置文件，支持容器化部署。

## 故障排除

### 常见问题

1. **端口占用错误**
   - 检查端口是否被其他程序占用
   - 修改 `.env` 文件中的 PORT 配置

2. **数据库连接错误**
   - 确保 `db` 目录存在且有写权限
   - 检查 `DB_PATH` 配置是否正确

3. **会话存储错误**
   - 确保 `sessions` 目录存在且有读写权限
   - 检查磁盘空间是否充足

4. **认证问题**
   - 检查 `AUTH_PASSWORD` 是否正确设置
   - 清除浏览器 Cookie 和会话数据

## 贡献指南

欢迎提交 Issue 和 Pull Request 来改进这个项目。

### 开发流程
1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

ISC License

## 更新日志

- v1.0.0: 初始版本，基本的HTML分享功能
- 支持密码保护和用户认证
- 添加Docker支持
- 优化用户界面和体验
