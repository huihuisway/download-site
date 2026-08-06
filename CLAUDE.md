# CLAUDE.md

面向在本仓库工作的 AI 助手与新加入的开发者。记录命令、架构要点，以及若干
不看代码就会踩的坑。

## 常用命令

```bash
npm ci                # 按锁文件安装（优于 npm install，能暴露版本漂移）
npm run dev           # 开发模式（node --watch）
npm start             # 生产模式
npm test              # 全部测试（node:test，无第三方测试框架）
node --test tests/public-routes.test.js   # 跑单个测试文件
npm run lint          # ESLint（flat config）
npm run format        # Prettier
npm run build:admin   # 构建后台 SPA 到 public/admin/
```

## 架构要点

### 分层

```
请求 → helmet(CSP nonce) → compression → session → /admin 静态
     → 静态资源 → attachUser → /auth → /api/admin → /api/v1 → 前台路由
     → notFoundHandler → errorHandler
```

`src/app.js` 里的挂载顺序是有意义的：`trust proxy` 必须在 session 之前，
CSP nonce 中间件必须在 helmet 之前。

### 数据库：不是 SQLite

`src/db/index.js` 是一个约 500 行的**自研 JSON 文件数据库**，用正则解析 SQL
字符串来模拟 better-sqlite3 的同步 API。这带来几条硬约束：

- **只支持有限的 SQL 子集**：`WHERE 字段 = ?` 形式的等值条件、`ORDER BY`、
  `LIMIT/OFFSET`、`COUNT`/`SUM`/`MAX`、`GROUP BY` 单字段。
  **不支持 `LIKE`**——需要模糊匹配时在 JS 层过滤（见 `stats.service.js` 的搜索、
  `file.service.js` 的子树前缀匹配）。
- **写入是防抖的**：语句级写操作调 `_scheduleSave()`（500ms 合并落盘），
  内存状态立即生效。测试若要断言磁盘内容，需显式调 `db._save()` 或 `db.close()`。
- **不是多进程安全的**：读改写整个文件，`ecosystem.config.js` 必须保持
  `instances: 1`。
- `schema.sql` / `migrations.js`：`db.exec()` 是 no-op，schema.sql 只是文档；
  但 `migrations.js` 的 `up()` 回调**会真正执行**（如 v2 把 API Key 哈希化），
  改数据结构时用它做迁移。

### 主题系统

`src/views/themes/<name>/` 下各有 `index / category / file / 404 / error` 五个模板，
共用 `src/views/partials/`（head / footer / error-card）。当前主题存在 `settings`
表，由 `theme.service.js` 读取。

- `error.ejs` 已抽取为共享 `partials/error-card.ejs`，各主题只是 3 行 include。
- `404.ejs` **有意保持各主题不同**（各自的文案风格），不要合并。
- 渲染错误页统一走 `src/utils/render-theme.js` 的 `renderThemeError`。

### 路由陷阱：前台 catch-all

`src/routes/public.js` 末尾的 `router.get('*')` 会把任何未匹配路径当作文件详情页。
新增顶层路由时**必须**同步把前缀加进同文件的 `RESERVED_ROOTS`，否则会被它吞掉。

同时注意编码：`/d/*` 的通配参数由 Express 自动解码，而 catch-all 用的是原始
`req.path`（需手动 `decodeURIComponent`）。生成链接一律用 `utils/public-paths.js`
与 `folder-tree.service.js` 的 `buildCategoryHref`，它们按段编码。

### 认证

三条路径：OAuth（MindAuth）、本地管理员账号、以及 `DEV_ADMIN_BYPASS=1` 的开发旁路
（生产环境永不生效）。后台权限由 `hasAdminAccess` 判定：本地管理员直接通过；
OAuth 用户看 `ADMIN_ALLOWED_EMAILS` 白名单，**白名单为空则任意 OAuth 用户可进后台**。

`/api/v1` 走独立的 API Key 认证（`middleware/apiKeyAuth.js`），Key 只存 SHA-256 哈希。

### 下载路由

`/d/*` 用 `res.download()`，因此免费获得 Range/ETag/Last-Modified 与合规的
`Content-Disposition`。计数挂在 `res.on('finish')`：完整下载或 `bytes=0-` 首片才 +1，
中段分片与 304 不计。**compression 中间件必须排除 `/d/*`**，否则会去掉
Content-Length 并破坏续传。

## 约定

- **CommonJS**，无 TypeScript。2 空格缩进、单引号、分号、尾逗号。
- 注释用中文；只写代码本身表达不了的约束（为什么这样做），不复述代码。
- **测试必须在 `require('../src/...')` 之前设置环境变量**——`config` 模块在加载时
  就读取它们。用 `tests/helpers/tmp-env.js` 的 `setupTmpEnv()` 拿独立临时目录，
  并在 `after()` 里调 `tmpEnv.cleanup()`。
- 两套 API 错误格式不同（历史原因）：`/api/admin` 用 `{ error }`，
  `/api/v1` 用 `{ success, error: { code, message } }`。新增接口沿用所在命名空间的格式。
- 改动 `admin/` 下的代码后需 `npm run build:admin`，产物 `public/admin/` 不入版本库。
- 管理后台是静态产物，**无法注入 CSP nonce**：需要在后台页面执行的内联脚本必须
  抽成 `public/js/` 下的外部文件。

## 未来工作

- 迁移到 SQLite（可去掉约 500 行正则 SQL 模拟，获得索引、增量写与多进程安全）
- `styleSrc` 目前仍需 `unsafe-inline`（主题模板含大段内联样式）
- `LOG_LEVEL` 已读入配置但未接线，全站仍用带 `[tag]` 前缀的 console
- 管理后台无前端测试；`alert`/`confirm` 反馈与弹窗可访问性有待改进

## 版本号

公共页脚显示 `v` 加 Git 提交计数，例如 `v1234`。每新增一个 commit，服务启动后版本号自动增加；没有 `.git` 的部署环境可通过 `APP_VERSION=v1234` 指定固定版本。
