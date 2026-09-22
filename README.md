# 轻量级极简下载站

Debian 镜像站风格的纯粹文件下载服务。

## 特性

- **极简前台**：4 套可切换主题，EJS 服务端渲染，SHA-256 展示与一键复制
- **现代后台**：React + Tailwind CSS，统计看板 + 文件管理 + 目录管理 + 批量操作
- **自动同步**：物理目录 ↔ 数据库双向同步，SHA256 流式计算
- **GitHub Releases 同步**：自动登记 Mindustry 主线与 Classic 来源，只同步各自最新正式版和最新预发布版，并支持自定义仓库来源
- **Mindustry 公共索引**：网页按游戏、正式版/预发布和平台展示；`/api/v1/mindustry/manifest.json` 无 Key，可供启动器读取
- **版本文件缓存**：Release 同步的版本化文件按 SHA-256 登记，并可缓存一年（`immutable`）
- **完整下载能力**：断点续传（Range）、协商缓存（ETag/Last-Modified）、中文文件名正确落地
- **双登录方式**：OAuth 2.0（对接论坛，state 防 CSRF）+ 本地管理员账号
- **第三方 API**：`/api/v1` 默认以 API Key 认证，Mindustry manifest 为公开无 Key 接口；支持文件审核流程对接
- **安全沙箱**：路径穿越防御、扩展名白/黑名单、文件名清洗、速率限制、nonce 化 CSP

## 快速开始

```bash
# 1. 安装依赖（严格按锁文件安装）
npm ci

# 2. 配置环境变量
cp .env.example .env
# 本地开发时将 NODE_ENV 改为 development；生产部署所需认证配置见下文。

# 3. 创建运行时目录
mkdir -p downloads data

# 4. 构建后台前端
npm run build:admin

# 5. 启动服务
npm run dev      # 开发模式（--watch 自动重启）
npm start        # 按 .env 的 NODE_ENV 启动；生产环境需先通过生产配置校验
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

## GitHub Releases 自动同步

Releases 同步由后台来源配置驱动，Token 不保存在数据库中。启用后默认每小时检查一次每个已启用来源；Mindustry 主线和 Classic 各读取最新正式版与最新预发布版，MDT Android 来源只读取当前最新稳定上游版本对应的 Release，不导入这些来源的全部历史版本。Classic 使用真实仓库 `Anuken/Mindustry-Classic`；上游仓库已归档且当前没有 GitHub Release 资产，因此站点不会伪造或自行标记官方二进制。其他普通 GitHub 来源仍可分页读取全部符合 Draft/prerelease 设置和资产筛选规则的 Releases。同步器跳过已完成版本并重试失败版本；资产还必须通过扩展名白名单、`MAX_FILE_SIZE` 筛选，并排除 GitHub 自动生成的源码包。新来源会在调度器首次运行时立即检查。

资产会先写入下载目录下的临时文件，完成实际大小和摘要校验后原子移动到版本隔离目录：

```text
downloads/github/{owner}/{repo}/{tag}/{asset}
```

Mindustry 主线和 Classic 会在 `Mindustry/{Main|Classic}/{Stable|Prerelease}/{tag}/{platform|Advanced}/{asset}` 下分类，每个来源当前最多同步一条正式版与一条预发布版。SHA-256 在下载时计算并写入数据库；已下载文件默认保留，不因远端版本变化自动删除。失败的网络请求会记录同步状态，管理员可以查看并重试。

### Mindustry Android 稳定版社区构建

`.github/workflows/mindustry-android.yml` 每天检查 Anuken/Mindustry 最新正式 Release，也支持手动指定正式版 tag。仅当该上游版本尚未发布对应 MDT Release 时，工作流才从该 tag 构建 APK，并把该版本的 APK、SHA-256 和来源信息发布到当前 GitHub 仓库的 Release。下载站只同步最新的对应 APK，不遍历并导入这个仓库的所有历史 Release。

首次启用前，需要在 GitHub 仓库配置 `MINDUSTRY_ANDROID_KEYSTORE_BASE64`、`MINDUSTRY_ANDROID_KEYSTORE_PASSWORD`、`MINDUSTRY_ANDROID_KEY_ALIAS` 和 `MINDUSTRY_ANDROID_KEY_PASSWORD` 四个 Actions secrets。使用同一把 MDT 密钥签署后续版本；不要轮换密钥，否则已安装的 MDT 构建无法直接升级。构建使用独立应用 ID `io.anuke.mindustry.mdt` 和名称“Mindustry MDT”，并按正式版本号生成递增的 Android `versionCode`，可与官方版并装且能在后续正式版间升级，但数据目录彼此独立。这是基于 Anuken 正式版源码的 MDT 社区构建，签名证书由 MDT 管理，不是 Anuken 官方签名包。

APK 资产名以 `Mindustry-MDT-Android-` 开头。工作流首次发布后，在下载站 `.env` 设置 `MINDUSTRY_ANDROID_RELEASE_REPOSITORY=owner/repository` 并重启；站点会自动添加该来源，只同步上述 APK 文件。站点默认扩展名白名单已包含 `.apk`。主线及 Classic 官方 Release 资产和 MDT 社区 Android 构建会分别标记来源，MDT APK 不标称为 Anuken 官方签名包。

### 下载统计与公开清单

网页点击和下载工具可向 `POST /count-download` 提交 `fileId`、`client_name`、`client_version`、`platform`。这些字段只用于下载统计和分析，不用于认证；统计事件最多保留 90 天，不记录事件级 IP。下载与清单均不要求 API Key。

```text
GET  /api/v1/mindustry/manifest.json   # 公开，IP 限流，短缓存
GET  /mindustry                       # 人类可读版本页
POST /count-download                  # 公开匿名统计
```

### 来源管理 API

以下接口均需要后台管理员认证：

```text
GET    /api/admin/releases/sources
POST   /api/admin/releases/sources
GET    /api/admin/releases/sources/:id
PUT    /api/admin/releases/sources/:id
DELETE /api/admin/releases/sources/:id
POST   /api/admin/releases/sources/:id/enable
POST   /api/admin/releases/sources/:id/disable
POST   /api/admin/releases/sources/:id/sync
GET    /api/admin/releases/sources/:id/preview
GET    /api/admin/releases/sources/:id/status
GET    /api/admin/releases/sources/:id/assets
GET    /api/admin/releases/sources/:id/jobs
POST   /api/admin/releases/sources/:id/retry
GET    /api/admin/releases/health
```

新增来源示例：

```json
{
  "name": "My App",
  "type": "github",
  "owner": "example",
  "repo": "my-app",
  "enabled": true,
  "target_category": "github/example/my-app",
  "asset_include_pattern": "MyApp-*",
  "asset_exclude_pattern": "*-debug*"
}
```

来源删除默认只删除配置，已经同步的本地文件不会被删除。生产部署必须保持单实例，因为当前 JSON 数据库和文件 Session 不支持多进程并发写入。


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
| GET/POST/PUT/DELETE | `/api/admin/releases/sources[/:id]` | GitHub Releases 来源管理 |
| POST | `/api/admin/releases/sources/:id/sync` | 立即同步指定来源 |
| GET | `/api/admin/releases/sources/:id/preview` | 预览最新 Release 资产 |
| GET | `/api/admin/releases/health` | Releases 同步健康状态 |

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
| `TRUST_PROXY_HOPS` | 信任的反向代理跳数，默认 `1`；按实际代理链设置，并确保代理覆盖客户端转发头 |
| `DOWNLOAD_DIR` | 文件沙箱目录，默认 `./downloads` |
| `DB_PATH` | JSON 数据库路径，默认 `./data/stats.db` |
| `MAX_FILE_SIZE` | 单文件上限字节数，默认 150MB |
| `SESSION_SECRET` | **必填**：≥32 字符随机串，生产环境使用默认值会拒绝启动 |
| `SESSION_MAX_AGE` | 会话有效期毫秒数，默认 1 天 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 可选本地管理员登录；生产密码至少 16 字符，不得使用占位值 |
| `ADMIN_ALLOWED_EMAILS` | OAuth 后台邮箱白名单（逗号分隔）；生产 OAuth 模式必填且不能使用示例地址 |
| `OAUTH_*` | OAuth 2.0 HTTPS 端点与凭据；生产环境须配置完整 OAuth，或改用强密码本地管理员 |
| `ALLOWED_EXTENSIONS` | 上传和 Releases 资产扩展名白名单（逗号分隔）；默认包含 `.apk` |
| `GITHUB_TOKEN` | GitHub API 只读 Token，仅从环境变量读取，不通过后台 API 保存或返回 |
| `GITHUB_REPOSITORY` | 可选的兼容性单仓库配置，格式为 `owner/repository` |
| `MINDUSTRY_ANDROID_RELEASE_REPOSITORY` | 可选；GitHub Actions 工作流发布 MDT APK 的 `owner/repository`，启动时自动添加 APK 同步来源 |
| `RELEASE_SYNC_ENABLED` | 是否启用 Releases 自动同步，`true`/`1` 启用，默认关闭 |
| `RELEASE_SYNC_INTERVAL_MS` | 同步周期，默认 3600000（1 小时），最短 5 分钟 |
| `RELEASE_SYNC_REQUEST_TIMEOUT_MS` | GitHub 请求超时时间，默认 30000 毫秒 |
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
node --version # 必须 >=18
cp .env.example .env
# 在 .env 设置 NODE_ENV=production、真实 OAuth + 邮箱白名单或强密码本地管理员，
# 并设置至少 32 字符的随机 SESSION_SECRET；不要把密钥提交到 Git。
npm ci
npm run build:admin
npm run lint
npm test
npm run verify:production
mkdir -p data downloads logs
# PM2 需预先安装为系统级工具。
sudo npm install --global pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

> ⚠️ **必须保持 `instances: 1` 且使用 `exec_mode: fork`**：JSON 文件数据库与文件式 Session 都不是多进程安全的，
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
