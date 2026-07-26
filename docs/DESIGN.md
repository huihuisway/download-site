# 轻量级极简下载站系统设计方案

> 修订终版 — 2026/06/13

---

> ## ⚠️ 历史设计文档
>
> 本文记录的是开发前的设计意图，部分内容与最终实现不一致。以实际代码为准，
> 主要差异如下：
>
> | 本文设计 | 实际实现 |
> |---|---|
> | SQLite + better-sqlite3 | JSON 文件数据库（`src/db/index.js`，模拟 better-sqlite3 API） |
> | connect-sqlite3 存 Session | session-file-store（文件存储于 `data/sessions/`） |
> | `file-type` 嗅探 magic number | 仅扩展名白名单 + 显式黑名单 |
> | 单一前台样式 | 4 套可切换主题（`src/views/themes/`） |
> | 仅 OAuth 登录 | OAuth + 本地管理员账号双方式 |
> | 未涉及 | `/api/v1` 第三方 API + API Key + 文件审核流程 |
>
> 另外 `src/db/schema.sql` 与 `src/db/migrations.js` 在 JSON 数据库下不执行建表
> （`db.exec()` 是 no-op），schema.sql 仅作为数据模型文档与将来迁移 SQLite 的参考。
>
> **SQLite 迁移列为未来工作**，届时可回到本文的相关章节。当前架构说明见
> [../CLAUDE.md](../CLAUDE.md) 与 [../README.md](../README.md)。

---

## 一、项目概述

构建一个类似 Debian 镜像站风格的纯粹文件下载服务。核心诉求：

- 界面极简，无多余视觉干扰
- 纯 Node.js / JavaScript 开发
- 无需 Docker，直接源码部署
- 前台面向公众：目录浏览 + 文件下载（完全开放）
- 后台面向管理员：文件管理 + 统计看板（OAuth 2.0 鉴权）
- 与现有论坛系统通过 OAuth 2.0 无缝对接

---

## 二、技术栈选型

| 模块 | 技术选型 | 选型理由 |
|---|---|---|
| 后端框架 | Node.js + Express | 生态成熟，路由灵活，完美契合 JS 开发偏好 |
| 前台渲染 | EJS | 服务端渲染，零前端构建负担，易于实现极简 HTML 结构 |
| 后台前端 | React + Tailwind CSS (Magic UI) | 现代化交互体验，组件丰富 |
| 数据库 | SQLite (better-sqlite3) | 单文件数据库，零配置。同步 API 性能极高 |
| Session 存储 | connect-sqlite3 | 持久化到 SQLite，进程重启不丢失，与项目技术栈一致 |
| 文件上传 | multer | 成熟可靠，支持单文件 / 多文件上传 |
| 文件名处理 | sanitize-filename | 有效防御路径遍历攻击 |
| MIME 检测 | file-type | 读取文件头魔数，补充扩展名白名单校验 |
| 进程管理 | PM2 | 保证 Node.js 进程稳定运行与自动重启 |

---

## 三、系统架构设计

### 3.1 分层模型

```
┌─────────────────────────────────────────────────────────────┐
│  接入层 (Nginx 自行配置)                                      │
│  80/443 → HTTPS 卸载 + Gzip → 反向代理 localhost:3000       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  应用层 (Node.js / Express)                                  │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ 前台路由 /   │  │ 后台 /admin │  │ OAuth /auth/*       │ │
│  │ EJS 渲染     │  │ React SPA   │  │ 授权码流转          │ │
│  │ 完全开放     │  │ Session 鉴权 │  │ state CSRF 防护     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│  ┌──────▼────────────────▼─────────────────────▼──────────┐ │
│  │ 文件流处理层                                            │ │
│  │ fs.createReadStream → res.set(Headers) → Stream 响应   │ │
│  └──────────────────────────┬─────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│  数据层                                                      │
│                                                              │
│  ./downloads/               stats.db (SQLite, WAL 模式)     │
│  ├── documents/             ┌───────────────────────────┐   │
│  │   ├── report.pdf         │ download_logs             │   │
│  │   └── guide.txt          │ + file_size, mime_type    │   │
│  ├── software/              │ + sha256, uploaded_by     │   │
│  │   ├── app-v1.0.zip       │ + description             │   │
│  │   └── app-v1.1.zip       │ + category (完整父目录路径) │   │
│  └── images/                └───────────────────────────┘   │
│      └── banner.png                                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 关键设计决策

| 决策项 | 结论 | 说明 |
|---|---|---|
| 前台下载权限 | 完全开放 | 知道链接即可下载，不做身份检查 |
| 目录结构 | 多级物理子目录 | `downloads/docs/guides/v1/file.zip`，分类为完整父目录路径 |
| 上传安全 | 扩展名白名单 | 限定允许的文件扩展名 |
| OAuth CSRF | 使用 state 参数 | 标准 OAuth 2.0 安全实践 |
| Session 存储 | SQLite 持久化 | 进程重启不丢失管理员登录态 |
| 速率限制 | 不需要 | 完全信任访问者 |
| SHA256 计算 | 仅新文件 | 新增或修改时间变化的文件才计算，避免全量扫描 |
| 文件描述 | 需要 | 管理员可为每个文件添加文字说明 |
| 附加功能 | 全部实现 | 下载统计看板、手动同步按钮、批量操作 |

---

## 四、核心功能模块设计

### 4.1 前台目录浏览 (Debian 风格)

**展示方式：**
- 从 SQLite 查询文件列表，按 `category` 分组展示
- 每个文件显示：文件名、文件大小（格式化）、最后修改时间、下载次数
- 文件描述展示在文件名下方（若有）

**排序：**
- 支持按文件名、大小、修改时间、下载量排序
- 默认按文件名升序

**下载行为：**
1. 用户点击文件链接
2. 后台拦截请求，`UPDATE download_count SET download_count = download_count + 1`
3. 更新 `last_download_at = CURRENT_TIMESTAMP`
4. 通过 `fs.createReadStream` + `res.set('Content-Type', mime_type)` 流式返回文件内容

**完全开放：**
- 无需登录，无需 Token
- 知道链接即可直接下载

### 4.2 后台管理系统 (Magic UI)

**权限隔离：**
- 所有后台 API (`/api/admin/*`) 必须通过 OAuth 2.0 Session 鉴权中间件
- 前台不渲染任何管理入口

**功能清单：**

| 功能 | 说明 |
|---|---|
| 文件上传 | 支持单文件 / 多文件 / 批量上传，上传时选择目标文件夹（已有多级目录） |
| 文件删除 | 单个 / 批量删除，物理文件 + DB 记录同步清理 |
| 文件重命名 | 修改显示文件名，同步更新 DB |
| 文件描述编辑 | 为文件添加 / 修改文字说明 |
| 下载统计看板 | 总下载量、热门 Top 10、按分类统计、近期下载趋势 |
| 手动同步按钮 | 触发物理目录 ↔ DB 双向同步 |
| 目录管理 | 创建 / 重命名 / 删除多级目录（支持子树操作和递归删除） |

### 4.3 自动同步与级联清理机制

**触发时机：**
- 服务启动时自动执行一次
- 后台手动点击"同步本地目录"按钮

**同步逻辑：**

```
1. 读取物理目录：
   递归扫描 ./downloads/ 下所有子目录和文件
   收集每个文件的：相对路径、文件名、大小、修改时间
   生成物理文件列表 A

2. 读取数据库：
   SELECT * FROM download_logs
   生成数据库记录列表 B

3. 新增 (UPSERT)：
   遍历 A，若文件路径不在 B 中：
   - INSERT 新记录
   - 写入 file_name, file_path, category (从子目录推断), file_size, mime_type, file_mtime
   - sha256：标记为待计算（新文件）
   - download_count 初始化为 0

4. 更新 (UPDATE)：
   遍历 A，若文件路径在 B 中：
   - 更新 file_size, file_mtime
   - 若 file_mtime 发生变化且 sha256 为空或已标记过时：
     触发异步 SHA256 重新计算

5. 级联清理 (DELETE)：
   遍历 B，若记录的 file_path 不在 A 中：
   - DELETE FROM download_logs WHERE file_path = ?
   - 彻底移除该记录，保持 100% 镜像一致

6. SHA256 异步计算：
   对所有 sha256 为空的记录，逐文件异步计算
   计算完成后 UPDATE sha256 = ? WHERE id = ?
```

**关键约束：**
- UPSERT 绝不覆盖 `download_count`（下载计数只增不减）
- 使用 `BEGIN IMMEDIATE` 事务，避免锁升级死锁
- 大量文件时分批处理，每 500 条提交一次事务，避免长时间持锁

### 4.4 OAuth 2.0 鉴权流程

```
1. 用户访问 /admin
2. Node.js 检查 Session：
   - 有效 → 直接渲染后台页面
   - 无效 → 进入 OAuth 流程

3. 生成 state：
   - 创建随机字符串 (crypto.randomBytes(16).toString('hex'))
   - 存入当前 Session: req.session.oauthState = state

4. 重定向至论坛授权页：
   GET 论坛域名/oauth/authorize
     ?client_id=下载站 client_id
     &redirect_uri=下载站域名/auth/callback
     &response_type=code
     &state={随机字符串}

5. 用户在论坛完成登录并授权

6. 论坛重定向回下载站：
   GET /auth/callback?code=xxx&state=yyy

7. 后端校验：
   a. 校验 state：req.session.oauthState === state（防 CSRF）
   b. 用 code 向论坛换取 Access Token：
      POST 论坛域名/oauth/token
        ?grant_type=authorization_code
        &code=xxx
        &client_id=xxx
        &client_secret=xxx
        &redirect_uri=xxx
   c. 用 Access Token 获取用户信息：
      GET 论坛域名/oauth/userinfo
        Authorization: Bearer {access_token}

8. 验证通过：
   - 将用户信息写入 Session：req.session.user = { id, username, ... }
   - 删除 req.session.oauthState
   - 重定向至 /admin

9. 验证失败：
   - 清除 Session
   - 重定向至论坛授权页或返回错误页
```

---

## 五、数据库设计 (SQLite)

### 5.1 download_logs 表

| 字段名 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | 自增主键 |
| file_name | TEXT | NOT NULL | 清洗后的安全文件名 |
| file_path | TEXT | NOT NULL, UNIQUE | 文件相对路径（如 `software/app-v1.0.zip`） |
| category | TEXT | NOT NULL | 完整父目录路径（从文件路径推导，如 `docs/guides/v1`） |
| file_size | INTEGER | NOT NULL | 文件大小 (bytes) |
| mime_type | TEXT | | MIME 类型（如 `application/zip`） |
| sha256 | TEXT | | SHA256 校验值（新文件 / 变更文件计算） |
| description | TEXT | | 文件描述 / 备注 |
| uploaded_by | INTEGER | | 上传者用户 ID（关联 OAuth 用户） |
| download_count | INTEGER | DEFAULT 0 | 累计下载次数 |
| last_download_at | DATETIME | | 最后一次下载时间 |
| file_mtime | DATETIME | NOT NULL | 物理文件修改时间（用于判断是否需重算 sha256） |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 记录创建时间 |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 记录更新时间 |

### 5.2 sessions 表

由 `connect-sqlite3` 自动创建和管理，无需手动建表。

### 5.3 索引

```sql
CREATE INDEX idx_category ON download_logs(category);
CREATE INDEX idx_file_path ON download_logs(file_path);
CREATE INDEX idx_download_count ON download_logs(download_count DESC);
```

### 5.4 SQLite 配置

```js
const Database = require('better-sqlite3');
const db = new Database('./data/stats.db');

// 启用 WAL 模式，优化并发读写性能
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB 缓存
db.pragma('foreign_keys = ON');
```

---

## 六、目录结构

```
download-site/
├── package.json
├── ecosystem.config.js          # PM2 配置
├── .env                         # 环境变量（OAuth 密钥等，不入 Git）
├── .env.example                 # 环境变量模板
├── .gitignore
├── README.md
│
├── src/                         # 后端源码
│   ├── app.js                   # Express 应用入口
│   │
│   ├── config/
│   │   ├── index.js             # 统一配置加载（读取 .env）
│   │   └── constants.js         # 白名单、限制值等常量
│   │
│   ├── db/
│   │   ├── index.js             # SQLite 连接初始化 (WAL 模式)
│   │   ├── schema.sql           # 建表 DDL
│   │   └── migrations.js        # 数据库版本迁移逻辑
│   │
│   ├── middleware/
│   │   ├── auth.js              # OAuth Session 校验中间件
│   │   ├── errorHandler.js      # 全局错误处理中间件
│   │   └── validate.js          # 请求参数校验中间件
│   │
│   ├── routes/
│   │   ├── public.js            # 前台公开路由 (/)
│   │   ├── admin.js             # 后台 API 路由 (/api/admin/*)
│   │   └── oauth.js             # OAuth 流程路由 (/auth/*)
│   │
│   ├── services/
│   │   ├── file.service.js      # 文件操作（上传/删除/重命名）
│   │   ├── sync.service.js      # 目录同步逻辑
│   │   ├── stats.service.js     # 下载统计查询
│   │   └── checksum.service.js  # SHA256 计算
│   │
│   ├── views/                   # EJS 模板（前台）
│   │   ├── layout.ejs           # 公共布局
│   │   ├── index.ejs            # 首页（全分类文件列表）
│   │   └── category.ejs         # 分类详情页
│   │
│   └── utils/
│       ├── filename.js          # 文件名清洗 / 安全校验
│       ├── format.js            # 文件大小格式化工具
│       └── stream.js            # 流式传输辅助函数
│
├── public/                      # 静态资源 + 后台构建产物
│   ├── css/
│   │   └── style.css            # 前台样式
│   └── admin/                   # React 构建产物输出目录
│       ├── index.html
│       └── static/
│
├── admin/                       # 后台 React 源码
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx    # 统计看板
│   │   │   ├── FileManager.jsx  # 文件管理（上传/删除/编辑）
│   │   │   └── Categories.jsx   # 目录管理
│   │   ├── components/
│   │   │   ├── FileTable.jsx    # 文件列表表格
│   │   │   ├── UploadModal.jsx  # 上传弹窗
│   │   │   ├── StatsCard.jsx    # 统计卡片
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   └── useAuth.js       # 登录态 Hook
│   │   └── api/
│   │       └── client.js        # API 请求封装
│   └── index.html
│
├── downloads/                   # 文件存储沙箱（运行时创建）
│   ├── documents/
│   ├── software/
│   └── images/
│
├── data/
│   └── stats.db                 # SQLite 数据库文件（运行时创建）
│
└── tests/                       # 测试
    ├── sync.test.js
    ├── file.test.js
    └── auth.test.js
```

---

## 七、安全策略

| 威胁 | 防御措施 | 实现方式 |
|---|---|---|
| 路径遍历攻击 | 沙箱边界校验 | `sanitize-filename` 清洗输入 + `path.resolve` + `startsWith(downloadsDir)` 校验最终路径 |
| 恶意文件上传 | 扩展名白名单 | 仅允许配置中指定的扩展名，拒绝 `.js`, `.sh`, `.php` 等 |
| 扩展名伪造 | 文件头魔数校验 | `file-type` 库读取文件头，交叉验证真实文件类型 |
| CSRF 攻击 | OAuth state 参数 | 授权请求携带随机 state，回调时严格校验一致性 |
| Session 劫持 | 安全 Cookie 属性 | `httpOnly: true` + `secure: true` (HTTPS) + `sameSite: 'strict'` |
| Session 固定攻击 | 登录后重新生成 | OAuth 验证通过后调用 `req.session.regenerate()` |
| 大文件攻击 | 单文件大小限制 | multer 配置 `limits: { fileSize: MAX_FILE_SIZE }` |
| 磁盘填满 | 总容量监控 | 上传前检查磁盘剩余空间，低于阈值拒绝上传 |
| 进程崩溃 | 自动重启 | PM2 `max_memory_restart` + 异常捕获 |
| 错误信息泄露 | 统一错误处理 | 全局 error handler 中间件，生产环境不返回堆栈信息 |

### 7.1 上传校验流程

```
文件上传请求
    │
    ▼
multer 接收文件（限制大小）
    │
    ▼
扩展名白名单校验 → 不通过 → 拒绝 + 删除临时文件
    │ 通过
    ▼
sanitize-filename 清洗文件名
    │
    ▼
path.resolve + startsWith 校验目标路径在沙箱内
    │ 通过
    ▼
写入 downloads/{category}/{safe_filename}
    │
    ▼
写入 / 更新 SQLite 记录
```

---

## 八、部署工作流

### 8.1 环境要求

- Node.js >= 18.x
- npm >= 9.x
- Nginx（反向代理 + HTTPS）
- PM2（进程管理）

### 8.2 部署步骤

```bash
# 1. 克隆项目
git clone <repo-url> download-site
cd download-site

# 2. 安装后端依赖
npm install

# 3. 配置环境变量
cp .env.example .env
nano .env   # 填入 OAuth client_id, client_secret, SESSION_SECRET 等

# 4. 创建运行时目录
mkdir -p downloads data

# 5. 构建后台前端
cd admin
npm install
npm run build     # 产物输出到 ../public/admin/
cd ..

# 6. 启动开发模式（调试用）
npm run dev

# 7. 生产部署
npm run build     # 如有后端构建步骤
pm2 start ecosystem.config.js
pm2 save
pm2 startup       # 配置开机自启
```

### 8.3 PM2 配置 (ecosystem.config.js)

```js
module.exports = {
  apps: [{
    name: 'download-site',
    script: 'src/app.js',
    instances: 1,              // SQLite 单文件，使用单实例
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
  }],
};
```

### 8.4 Nginx 参考配置

```nginx
server {
    listen 80;
    server_name downloads.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name downloads.example.com;

    ssl_certificate     /etc/letsencrypt/live/downloads.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/downloads.example.com/privkey.pem;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # 静态资源直接由 Nginx 处理
    location /css/ {
        alias /path/to/download-site/public/css/;
        expires 7d;
    }

    location /admin/ {
        alias /path/to/download-site/public/admin/;
        try_files $uri $uri/ /admin/index.html;
    }

    # 其余请求代理到 Node.js
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 上传文件大小限制（与 Node.js 侧保持一致）
    client_max_body_size 100M;
}
```

---

## 九、环境变量配置 (.env)

```env
# ===== 服务配置 =====
PORT=3000
NODE_ENV=production

# ===== 文件存储 =====
DOWNLOAD_DIR=./downloads
DB_PATH=./data/stats.db
MAX_FILE_SIZE=104857600          # 100MB (bytes)

# ===== OAuth 2.0 =====
OAUTH_AUTHORIZE_URL=https://forum.example.com/oauth/authorize
OAUTH_TOKEN_URL=https://forum.example.com/oauth/token
OAUTH_USERINFO_URL=https://forum.example.com/oauth/userinfo
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret
OAUTH_CALLBACK_URL=https://downloads.example.com/auth/callback

# ===== Session =====
SESSION_SECRET=your_random_secret_key_here    # 建议 openssl rand -hex 32 生成
SESSION_MAX_AGE=86400000                      # 24 小时 (ms)

# ===== 上传白名单 =====
ALLOWED_EXTENSIONS=.zip,.iso,.pdf,.txt,.png,.jpg,.jpeg,.gz,.tar,.7z,.doc,.docx,.xlsx,.md

# ===== 日志 =====
LOG_LEVEL=info
```

---

## 十、API 接口设计

### 10.1 前台 API (公开)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 首页，展示根目录文件列表 |
| GET | `/category/*` | 目录页，展示指定多级文件夹下的直接子目录和文件 |
| GET | `/d/*` | 下载文件（触发计数 + 流式返回） |

### 10.2 后台 API (需鉴权)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/files` | 获取文件列表（支持分页、排序、按分类过滤） |
| POST | `/api/admin/files/upload` | 上传文件（multipart/form-data） |
| DELETE | `/api/admin/files/:id` | 删除单个文件 |
| DELETE | `/api/admin/files/batch` | 批量删除文件（body: { ids: [] }） |
| PUT | `/api/admin/files/:id` | 更新文件信息（重命名 / 描述 / 移动文件夹） |
| GET | `/api/admin/stats` | 获取统计看板数据 |
| GET | `/api/admin/stats/top` | 获取热门 Top 10 |
| POST | `/api/admin/sync` | 手动触发目录同步 |
| GET | `/api/admin/categories` | 获取文件夹树列表 |
| POST | `/api/admin/categories` | 创建多级目录 |
| PUT | `/api/admin/folders/rename` | 重命名目录（子树路径同步更新） |
| POST | `/api/admin/folders/delete` | 删除目录（支持空目录删除和递归删除） |

### 10.3 OAuth 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/auth/login` | 发起 OAuth 授权（重定向至论坛） |
| GET | `/auth/callback` | OAuth 回调（处理授权码） |
| GET | `/auth/logout` | 登出（销毁 Session） |
| GET | `/auth/me` | 获取当前登录用户信息 |

---

## 十一、实施计划

### Phase 1: 基础框架 (Day 1-2)
- [ ] 初始化项目结构、package.json
- [ ] 配置 Express + EJS + SQLite
- [ ] 实现数据库 schema 初始化
- [ ] 实现文件同步服务（核心）

### Phase 2: 前台功能 (Day 3-4)
- [ ] 实现前台目录浏览页面（EJS）
- [ ] 实现文件下载流式传输 + 计数
- [ ] 前台样式（极简 Debian 风格）

### Phase 3: 后台 API (Day 5-7)
- [ ] OAuth 2.0 鉴权流程
- [ ] Session 管理（connect-sqlite3）
- [ ] 文件上传 / 删除 / 重命名 API
- [ ] 统计看板 API
- [ ] 批量操作 API

### Phase 4: 后台前端 (Day 8-10)
- [ ] React 项目初始化 + Tailwind 配置
- [ ] 统计看板页面
- [ ] 文件管理页面（列表 + 上传 + 批量操作）
- [ ] 目录管理页面

### Phase 5: 部署上线 (Day 11-12)
- [ ] PM2 配置 + 测试
- [ ] Nginx 配置 + HTTPS
- [ ] 端到端测试
- [ ] 上线部署
