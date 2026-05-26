# 团队聊天室 v2.0

公司内部使用的多人在线聊天工具。支持文字、图片、文件传输，消息持久化存储。

## 功能

- **用户自动登录** - 首次设置昵称后自动记住，下次直接进聊天室
- **消息持久化** - SQLite 数据库存储，重启服务不丢记录
- **文件传输** - 支持图片、PDF、Word、Excel、TXT、ZIP 等文件（最大 20MB）
- **实时通信** - WebSocket 实时推送，显示在线用户列表
- **连接状态** - 显示连接/断开/重连状态
- **发送重试** - 发送失败可点击重试
- **响应式设计** - 支持电脑和手机
- **安全过滤** - XSS 防护、危险文件类型拦截

## 部署

### Render 一键部署（推荐）

代码已包含 `render.yaml`，直接连接 GitHub 仓库即可自动部署。

### 本地运行

```bash
# 1. 安装 Node.js (https://nodejs.org)
# 2. 安装依赖
npm install

# 3. 启动
npm start
```

启动后访问 `http://localhost:3000`

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `HOST` | 绑定地址 | `0.0.0.0` |
| `NODE_ENV` | 运行环境 | - |

## 项目结构

```
.
├── server.js          # 后端服务 (Express + Socket.IO + SQLite)
├── package.json       # 依赖配置
├── render.yaml        # Render 部署配置
├── public/
│   ├── index.html     # 页面结构
│   ├── style.css      # 样式
│   └── app.js         # 前端逻辑
└── uploads/           # 上传文件存储目录 (自动创建)
```

## API 接口

- `GET /api/messages?limit=50` - 获取历史消息
- `POST /api/upload` - 文件上传
- `WebSocket /` - 实时通信

## 文件说明

| 文件 | 大小 | 说明 |
|------|------|------|
| server.js | 276 行 | 后端服务，含 SQLite、文件上传、WebSocket |
| public/app.js | 714 行 | 前端逻辑，含用户持久化、文件上传、消息渲染 |
| public/style.css | 540 行 | 样式，现代简洁设计 |
| public/index.html | 157 行 | 页面结构 |
