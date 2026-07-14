# 第三方公开 API 开发计划

## Context

当前下载站只有后台管理 API（`/api/admin/*`，需 OAuth 登录），无法满足第三方程序化操作文件的需求。需要开发一套公开的 RESTful API，让第三方通过 API Key 认证后执行文件上传、更新、删除、目录管理等操作。

**用户决策：**
- 认证方式：API Key（后台生成/管理，Header 传递）
- 权限粒度：读（read）/ 写（write）两级
- 路径前缀：`/api/v1/`

---

## 一、API Key 数据模型

在 JSON DB 中新增 `api_keys` 表（数组），存储在 `db.data.api_keys`：

```js
{
  id: 1,
  name: "CI/CD 部署",           // Key 名称（用户自定义）
  key: "dk_xxxxxxxxxxxxxxxxx",  // 生成的 Key（唯一）
  permission: "write",          // "read" | "write"
  created_at: "2026-07-13T...",
  last_used_at: null,
  is_active: true               // false = 已撤销
}
```

- `read` 权限：只能查询文件列表、文件详情、分类列表
- `write` 权限：包含 read + 上传/更新/删除/目录操作
- Key 格式：`dk_` 前缀 + 32 位随机 hex

---

## 二、API 端点设计

### 认证方式
所有请求必须在 Header 中传递：
```
Authorization: Bearer dk_xxxxxxxxxxxxxxxxx
```

### 端点列表

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/v1/files` | read | 文件列表（支持分页、分类过滤、搜索） |
| GET | `/api/v1/files/:id` | read | 文件详情 |
| POST | `/api/v1/files/upload` | write | 上传文件（multipart/form-data） |
| PUT | `/api/v1/files/:id` | write | 更新文件（重命名/描述） |
| DELETE | `/api/v1/files/:id` | write | 删除单个文件 |
| POST | `/api/v1/files/batch-delete` | write | 批量删除 |
| GET | `/api/v1/categories` | read | 分类列表 |
| POST | `/api/v1/categories` | write | 新建目录/分类 |
| DELETE | `/api/v1/categories/:name` | write | 删除空分类 |

### 统一响应格式

成功：
```json
{
  "success": true,
  "data": { ... }
}
```

错误：
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "API Key 无效或已撤销"
  }
}
```

错误码：`UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_ERROR` / `SERVER_ERROR`

---

## 三、实现方案

### 3.1 API Key 服务层
- **新建** `src/services/api-key.service.js`
  - `generateKey(name, permission)` — 生成新 Key
  - `validateKey(keyString)` — 验证 Key 并返回 key 对象
  - `listKeys()` — 列出所有 Key
  - `revokeKey(id)` — 撤销 Key
  - `touchKey(id)` — 更新 last_used_at

### 3.2 API Key 认证中间件
- **新建** `src/middleware/apiKeyAuth.js`
  - 从 `Authorization: Bearer xxx` 提取 Key
  - 调用 `validateKey` 验证
  - 检查 `is_active` 状态
  - 将 key 对象挂到 `req.apiKey`（含 permission 字段）
  - 写权限操作前检查 `req.apiKey.permission === 'write'`

### 3.3 公开 API 路由
- **新建** `src/routes/api-v1.js`
  - 复用 `file.service.js` 的 `uploadFiles`, `deleteFile`, `batchDelete`, `renameFile`, `updateDescription`, `moveFile`, `createCategory`, `deleteCategory`, `getCategories`
  - 复用 `stats.service.js` 的 `getAllFiles`, `getFileById`
  - 所有路由先过 `apiKeyAuth` 中间件
  - 写操作路由额外检查 `writePermission` 中间件

### 3.4 路由注册
- **修改** `src/app.js` — 添加 `app.use('/api/v1', apiV1Routes)`

### 3.5 DB 初始化
- **修改** `src/db/index.js` — `_load()` 中初始化 `this.data.api_keys = []`

### 3.6 后台管理 UI
- **新建** `admin/src/pages/ApiKeys.jsx` — API Key 管理页面
  - 列表展示所有 Key（名称、权限、创建时间、最后使用、状态）
  - 创建新 Key 对话框（名称 + 权限选择）
  - 撤销 Key 按钮
  - 创建后显示完整 Key（仅显示一次）
- **修改** `admin/src/App.jsx` — 添加路由和侧边栏导航项
- **修改** `admin/src/api/client.js` — 添加 Key 管理 API 方法

### 3.7 后台管理 API（扩展现有 admin 路由）
- **修改** `src/routes/admin.js` — 添加 Key 管理端点：
  - `GET /api/admin/api-keys` — 列表
  - `POST /api/admin/api-keys` — 创建
  - `DELETE /api/admin/api-keys/:id` — 撤销

---

## 四、涉及的关键文件

| 操作 | 文件 |
|------|------|
| 新建 | `src/services/api-key.service.js` |
| 新建 | `src/middleware/apiKeyAuth.js` |
| 新建 | `src/routes/api-v1.js` |
| 新建 | `admin/src/pages/ApiKeys.jsx` |
| 修改 | `src/app.js` |
| 修改 | `src/db/index.js` |
| 修改 | `src/routes/admin.js` |
| 修改 | `admin/src/App.jsx` |
| 修改 | `admin/src/api/client.js` |

---

## 五、可复用的现有代码

- `src/services/file.service.js` — `uploadFiles`, `deleteFile`, `batchDelete`, `renameFile`, `updateDescription`, `moveFile`, `createCategory`, `deleteCategory`, `getCategories`
- `src/services/stats.service.js` — `getAllFiles`, `getFileById`
- `src/utils/filename.js` — `sanitizeFilename`, `ensureInSandbox`
- `src/config/constants.js` — `MAX_FILE_SIZE`, `MAX_BATCH_SIZE`

---

## 六、验证方案

### 创建 Key 后通过 curl 测试
```bash
# 1. 通过后台创建 Key（或手动写入 DB）

# 2. 读取权限测试
curl -H "Authorization: Bearer dk_xxx" http://localhost:8888/api/v1/files
curl -H "Authorization: Bearer dk_xxx" http://localhost:8888/api/v1/categories

# 3. 写入权限测试
curl -X POST -H "Authorization: Bearer dk_xxx" \
  -F "files=@test.zip" \
  "http://localhost:8888/api/v1/files/upload?category=software"

curl -X DELETE -H "Authorization: Bearer dk_xxx" \
  http://localhost:8888/api/v1/files/1

# 4. 只读 Key 写操作应返回 403
curl -X POST -H "Authorization: Bearer dk_readonly_key" \
  -F "files=@test.zip" \
  "http://localhost:8888/api/v1/files/upload?category=software"

# 5. 无效 Key 应返回 401
curl -H "Authorization: Bearer invalid_key" http://localhost:8888/api/v1/files
```

### 回归测试
- `npm test` — 现有 49 个测试全部通过
- 后台管理功能正常
- 前台页面正常
