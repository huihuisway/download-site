# 轻量级极简下载站

Debian 镜像站风格的纯粹文件下载服务。

## 特性

- **极简前台**：4 套可切换主题，EJS 服务端渲染，仅一小段内联脚本用于主题切换
- **现代后台**：React + Tailwind CSS，统计看板 + 文件管理 + 目录管理 + 批量操作
- **自动同步**：物理目录 ↔ 数据库双向同步，SHA256 流式计算
- **完整下载能力**：断点续传（Range）、协商缓存（ETag/Last-Modified）、中文文件名正确落地
- **双登录方式**：OAuth 2.0（对接论坛，state 防 CSRF）+ 本地管理员账号
- **第三方 API**：`/api/v1` 以 API Key 认证，支持文件审核流程对接
- **安全沙箱**：路径穿越防御、扩展名白/黑名单、文件名清洗、速率限制、nonce 化 CSP

## 快速开始

```bash
# 1. 安装依赖（严格按锁文件安装）
npm ci

# 2. 配置环境变量
cp .env.example .env
# 至少要设置 SESSION_SECRET（≥32 字符随机串），生产环境未设置会拒绝启动

# 3. 创建运行时目录
mkdir -p downloads data

# 4. 构建后台前端
npm run build:admin

# 5. 启动服务
npm run dev      # 开发模式（--watch 自动重启）
npm start        # 生产模式
```

## 项目结构

```
download-site/
├── src/                  # 后端源码
│   ├── app.js            # Express 入口（中间件顺序、路由挂载、启动流程）
│   ├── config/           # 配置与常量
│   ├── db/               # 数据库（JSON 文件存储，模拟 better-sqlite3 API）
│   ├── middleware/       # 认证 / API Key / 限流 / 错误处理
│   ├── routes/           # 路由（前台 / 后台 / OAuth / api-v1）
│   ├── services/         # 业务逻辑（文件/同步/统计/主题/目录树/校验/API Key）
│   ├── views/            # EJS 模板（partials + themes/<name>/）
│   └── utils/            # 工具函数
├── admin/                # React 后台源码（Vite）
├── public/               # 静态资源（CSS/字体/脚本）+ 后台构建产物
├── downloads/            # 文件存储沙箱
├── data/                 # 运行时数据（JSON 库 + session 文件）
├── docs/                 # API.md（详细接口文档）/ DESIGN.md（历史设计）
└── tests/                # 测试（node:test）
```

## 目录分类

文件按物理子目录组织，支持任意层级嵌套，分类从路径自动推断：

```
downloads/
├── documents/          # 分类 documents
├── software/
│   └── linux/          # 分类 software/linux
└── images/
```

## 主题

内置 4 套主题，在管理后台「主题设置」中切换（存于 `settings` 表）：

| 主题 | 风格 |
|---|---|
| `editorial` | 编辑/杂志风：衬线标题 + 纯黑白 + 侧栏导航 |
| `cloud` | 经典网盘风：卡片 + 圆角 + 分类标签 |
| `mirror` | 镜像站/技术风：紧凑表格，类 Debian 镜像站 |
| `terminal` | 暗色终端风：深色背景 + 等宽字体 |

字体（Inter / Geist Mono）自托管于 `public/fonts/`，不依赖 Google Fonts。

## 文件审核流程

供论坛侧通过 `/api/v1` 驱动，字段 `approval_status`：

- `pending` — 等待审核，前台访问返回 403 并展示等待提示
- `approved` — 正常可访问
- `rejected` — 前台返回 403 并展示 `reject_reason`
- 未设置（NULL）— 视为无需审核，正常可访问

## API 接口

### 前台（公开）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 首页（根目录浏览） |
| GET | `/category/*` | 目录页，支持多层路径 |
| GET | `/<file_path>` | 文件详情页 |
| GET | `/d/<file_path>` | 真实下载（计数、支持 Range 续传） |

### 后台（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/stats` | 统计看板 |
| GET | `/api/admin/stats/top` | 热门文件 |
| GET | `/api/admin/files` | 文件列表（支持 `search` / `category` / 分页 / 排序） |
| POST | `/api/admin/files/upload` | 上传文件 |
| PUT | `/api/admin/files/:id/rename` | 重命名 |
| PUT | `/api/admin/files/:id/move` | 移动到指定目录 |
| DELETE | `/api/admin/files/:id` | 删除文件 |
| POST | `/api/admin/files/batch-delete` | 批量删除 |
| POST | `/api/admin/sync` | 手动同步目录 |
| GET/POST/DELETE | `/api/admin/categories[/:name]` | 分类管理（嵌套名需 URL 编码） |
| POST/PUT/POST | `/api/admin/folders[/rename\|/delete]` | 目录管理 |
| GET/PUT | `/api/admin/theme` | 主题读取/切换 |
| GET/PUT | `/api/admin/settings` | 站点信息 |
| GET/POST/DELETE | `/api/admin/api-keys[/:id]` | API Key 管理 |

### 第三方 API（`/api/v1`，需 API Key）

请求头携带 `Authorization: Bearer dk_xxx`。Key 分 `read` / `write` 两级权限，
在后台「API Keys」页面创建（完整 Key 仅在创建时展示一次，服务端只存 SHA-256 哈希）。

覆盖文件的增删改查、分类管理，以及 `PUT /api/v1/files/:id/approval` 审核状态同步。
完整字段与示例见 [docs/API.md](docs/API.md)。

## 环境变量

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 3000 |
| `NODE_ENV` | `production` 时启用生产行为（配置校验 fail-fast、Secure cookie 等） |
| `DOWNLOAD_DIR` | 文件沙箱目录，默认 `./downloads` |
| `DB_PATH` | JSON 数据库路径，默认 `./data/stats.db` |
| `MAX_FILE_SIZE` | 单文件上限字节数，默认 150MB |
| `SESSION_SECRET` | **必填**：≥32 字符随机串，生产环境使用默认值会拒绝启动 |
| `SESSION_MAX_AGE` | 会话有效期毫秒数，默认 1 天 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 本地管理员登录（论坛未上线时的方案） |
| `ADMIN_ALLOWED_EMAILS` | 后台邮箱白名单（逗号分隔）。留空则任意 OAuth 用户可进后台 |
| `OAUTH_*` | OAuth 2.0 端点与凭据，见 `.env.example` |
| `ALLOWED_EXTENSIONS` | 上传扩展名白名单（逗号分隔） |
| `RATE_LIMIT_LOGIN_MAX` | 登录失败次数上限 / 15 分钟，默认 5 |
| `RATE_LIMIT_API_MAX` | `/api/v1` 每分钟每 Key 上限，默认 120 |
| `RATE_LIMIT_DOWNLOAD_MAX` | 下载每分钟每 IP 上限，默认 60 |
| `DEV_ADMIN_BYPASS` | **危险**：设为 `1` 时非生产环境所有未登录请求自动获得管理员权限，仅本地开发用 |
| `LOG_LEVEL` | 预留字段，当前未生效 |

## 开发

```bash
npm test            # 运行测试（node:test）
npm run lint        # ESLint 检查
npm run lint:fix    # 自动修复
npm run format      # Prettier 格式化
npm run build:admin # 构建后台 SPA
```

## 生产部署

```bash
npm ci
npm run build:admin
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

> ⚠️ **必须保持 `instances: 1`**：JSON 文件数据库与文件式 Session 都不是多进程安全的，
> 提高实例数会导致数据互相覆盖。需要横向扩展时应先迁移到 SQLite/Redis。

## 技术栈

- **后端**：Node.js ≥18 + Express 4（CommonJS）
- **前台**：EJS 服务端渲染，4 套主题
- **后台**：React 18 + Tailwind CSS + Vite
- **数据库**：JSON 文件存储（模拟 better-sqlite3 API，未来可迁移 SQLite）
- **Session**：文件存储（session-file-store）
- **上传**：multer 2.x
- **安全**：helmet（nonce 化 CSP）+ express-rate-limit + sanitize-filename
- **压缩**：compression（下载路由除外，以保证 Range 可用）

## License

MIT
