# 下载站 API 文档

> 版本：v1.0 | 基础地址：`/api/v1`

---

## 一、认证

所有 API 请求必须在 HTTP Header 中携带有效的 API Key：

```
Authorization: Bearer dk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### API Key 类型

| 权限 | 说明 |
|------|------|
| `read` | 仅可查询文件列表、文件详情、分类列表 |
| `write` | 包含 read 权限 + 上传、更新、删除、目录操作 |

### 获取 API Key

在管理后台 → **API Key** 页面创建。创建后完整 Key 仅显示一次，请立即复制保存。

---

## 二、通用约定

### 请求格式

- JSON 请求体使用 `Content-Type: application/json`
- 文件上传使用 `multipart/form-data`

### 响应格式

**成功：**
```json
{
  "success": true,
  "data": { ... }
}
```

**错误：**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `UNAUTHORIZED` | 401 | 缺少 API Key、Key 无效或已撤销 |
| `FORBIDDEN` | 403 | Key 权限不足（只读 Key 尝试写操作） |
| `NOT_FOUND` | 404 | 请求的文件或分类不存在 |
| `VALIDATION_ERROR` | 400 | 请求参数校验失败 |
| `SERVER_ERROR` | 500 | 服务器内部错误 |

---

---

## 四、后台 GitHub Releases 来源管理

> 以下接口挂载在 `/api/admin`，使用后台 Session 管理员认证，不使用 `/api/v1` API Key。
> `GITHUB_TOKEN` 只从服务器环境变量读取，不能通过接口写入或读取。

### 4.1 来源字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 来源显示名称 |
| `type` | string | 固定为 `github` |
| `owner` | string | GitHub Owner，仅允许字母、数字、`.`, `_`, `-` |
| `repo` | string | GitHub 仓库名 |
| `enabled` | boolean | 是否参与自动同步 |
| `target_category` | string | 下载站目标目录 |
| `asset_include_pattern` | string | 可选的资产名称包含规则 |
| `asset_exclude_pattern` | string | 可选的资产名称排除规则 |
| `include_prerelease` | boolean | 是否允许 prerelease，默认允许 |
| `include_draft` | boolean | 是否允许 draft，默认不允许 |
| `sync_interval_ms` | number | 可选周期，范围 5 分钟至 7 天 |

### 4.2 来源 CRUD

```text
GET    /api/admin/releases/sources
POST   /api/admin/releases/sources
GET    /api/admin/releases/sources/:id
PUT    /api/admin/releases/sources/:id
DELETE /api/admin/releases/sources/:id
```

创建请求示例：

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

`PUT` 支持部分更新。删除来源只删除来源配置，默认保留已同步文件和下载记录。

### 4.3 来源操作

```text
POST /api/admin/releases/sources/:id/enable
POST /api/admin/releases/sources/:id/disable
POST /api/admin/releases/sources/:id/sync
GET  /api/admin/releases/sources/:id/preview
GET  /api/admin/releases/sources/:id/status
GET  /api/admin/releases/sources/:id/assets
GET  /api/admin/releases/sources/:id/jobs
POST /api/admin/releases/sources/:id/retry
GET  /api/admin/releases/health
```

`sync` 会选择最新的非 Draft Release，正式版和 prerelease 均可。资产必须通过扩展名白名单、`MAX_FILE_SIZE`、源码包排除和文件名规则；成功后自动公开。文件写入版本隔离目录：

```text
downloads/{target_category}/{tag}/{asset}
```


### 3.1 获取文件列表

```
GET /api/v1/files
```

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 50 | 每页数量（最大 200） |
| `sortBy` | string | `file_name` | 排序字段：`file_name` / `file_size` / `download_count` / `file_mtime` / `created_at` |
| `sortOrder` | string | `ASC` | 排序方向：`ASC` / `DESC` |
| `category` | string | — | 按文件夹路径过滤（如 `docs/guides/v1`） |
| `search` | string | — | 按文件名搜索 |

**示例：**
```bash
curl -H "Authorization: Bearer dk_xxx" \
  "http://localhost:8888/api/v1/files?page=1&pageSize=20&category=software"
```

**响应：**
```json
{
  "success": true,
  "data": {
    "files": [
      {
        "id": 1,
        "file_name": "readme.zip",
        "file_path": "software/readme.zip",
        "category": "documents",
        "file_size": 1024,
        "download_count": 5,
        "mime_type": "application/zip",
        "sha256": "a1b2c3d4...",
        "description": "示例文件",
        "approval_status": null,
        "approval_source": null,
        "approval_resource_id": null,
        "reject_reason": null,
        "created_at": "2026-07-13T10:00:00.000Z",
        "updated_at": "2026-07-13T10:00:00.000Z",
        "last_download_at": "2026-07-13T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

### 3.2 获取文件详情

```
GET /api/v1/files/:id
```

**示例：**
```bash
curl -H "Authorization: Bearer dk_xxx" \
  http://localhost:8888/api/v1/files/1
```

**响应：**
```json
{
  "success": true,
  "data": {
    "file": {
      "id": 1,
      "file_name": "readme.zip",
      "file_path": "software/readme.zip",
      "category": "software",
      "file_size": 1024,
      "download_count": 5,
      "mime_type": "application/zip",
      "sha256": "a1b2c3d4...",
      "description": "示例文件",
      "created_at": "2026-07-13T10:00:00.000Z",
      "updated_at": "2026-07-13T10:00:00.000Z",
      "last_download_at": "2026-07-13T12:00:00.000Z"
    }
  }
}
```

---

### 3.3 上传文件

> 权限：**write**

```
POST /api/v1/files/upload
```

**Content-Type:** `multipart/form-data`

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `files` | File[] | 是 | 上传的文件（最多 20 个） |
| `category` | string | 否 | 目标文件夹路径（通过 query 参数传递，如 `docs/guides`） |

**示例：**
```bash
curl -X POST \
  -H "Authorization: Bearer dk_xxx" \
  -F "files=@document.pdf" \
  -F "files=@image.png" \
  "http://localhost:8888/api/v1/files/upload?category=documents"
```

**响应：**
```json
{
  "message": "成功上传 2 个文件",
  "files": [
    {
      "file_name": "document.pdf",
      "file_path": "documents/document.pdf",
      "file_size": 204800
    },
    {
      "file_name": "image.png",
      "file_path": "documents/image.png",
      "file_size": 51200
    }
  ]
}
```

**允许的文件类型：**
`.zip` `.iso` `.pdf` `.txt` `.png` `.jpg` `.jpeg` `.gz` `.tar` `.7z` `.doc` `.docx` `.xlsx` `.md` `.jar`

**文件大小限制：** 150MB

---

### 3.4 更新文件

> 权限：**write**

```
PUT /api/v1/files/:id
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 新文件名 |
| `description` | string | 否 | 文件描述（传 `null` 清空） |

至少提供 `name` 或 `description` 之一。

**示例：**
```bash
curl -X PUT \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name":"new-name.pdf","description":"更新后的描述"}' \
  http://localhost:8888/api/v1/files/1
```

**响应：**
```json
{
  "success": true,
  "data": {
    "old_path": "documents/old-name.pdf",
    "new_path": "documents/new-name.pdf",
    "new_name": "new-name.pdf"
  }
}
```

---

### 3.5 删除文件

> 权限：**write**

```
DELETE /api/v1/files/:id
```

**示例：**
```bash
curl -X DELETE \
  -H "Authorization: Bearer dk_xxx" \
  http://localhost:8888/api/v1/files/1
```

**响应：**
```json
{
  "success": true,
  "data": {
    "deleted": "software/readme.zip"
  }
}
```

---

### 3.6 批量删除

> 权限：**write**

```
POST /api/v1/files/batch-delete
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ids` | number[] | 是 | 要删除的文件 ID 列表（最多 100 个） |

**示例：**
```bash
curl -X POST \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2,3]}' \
  http://localhost:8888/api/v1/files/batch-delete
```

**响应：**
```json
{
  "success": true,
  "data": {
    "deleted": ["software/a.zip", "docs/b.pdf"],
    "errors": [{"id": 3, "error": "记录不存在"}]
  }
}
```

---

## 四、目录接口

### 4.1 获取文件夹列表

```
GET /api/v1/categories
```

**示例：**
```bash
curl -H "Authorization: Bearer dk_xxx" \
  http://localhost:8888/api/v1/categories
```

**响应：**
```json
{
  "success": true,
  "data": {
    "categories": [
      {
        "category": "documents",
        "file_count": 10,
        "total_size": 2048000,
        "total_downloads": 45
      },
      {
        "category": "documents/guides",
        "file_count": 5,
        "total_size": 512000,
        "total_downloads": 12
      }
    ]
  }
}
```

---

### 4.2 创建目录

> 权限：**write**

```
POST /api/v1/categories
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 目录路径（支持多级，如 `docs/guides/v2`） |

**示例：**
```bash
curl -X POST \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"name":"docs/guides/v2"}' \
  http://localhost:8888/api/v1/categories
```

**响应：**
```json
{
  "success": true,
  "data": {
    "category": "docs/guides/v2",
    "path": "/path/to/downloads/docs/guides/v2"
  }
}
```

---

### 4.3 删除目录

> 权限：**write**

```
DELETE /api/v1/categories/:name
```

仅在目录为空（无文件）时可删除。如需删除非空目录，请使用递归删除接口。

**示例：**
```bash
curl -X DELETE \
  -H "Authorization: Bearer dk_xxx" \
  http://localhost:8888/api/v1/categories/images
```

**响应：**
```json
{
  "success": true,
  "data": {
    "deleted": "images"
  }
}
```

---

### 3.7 审核状态同步

> 权限：**write**

供外部系统（如 MindFourm 论坛）同步文件的审核状态。设置状态后，下载路由会根据状态拦截或放行。

```
PUT /api/v1/files/:id/approval
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 是 | `pending` / `approved` / `rejected` |
| `resource_id` | number | 否 | 关联的外部资源 ID |
| `reject_reason` | string | 否 | 拒绝原因（仅 `rejected` 时有效） |

**状态说明：**

| 状态 | 下载行为 |
|------|---------|
| `null`（默认） | 正常下载，无限制 |
| `pending` | 403 拦截，提示"等待审核" |
| `approved` | 正常下载（同 null） |
| `rejected` | 403 拦截，显示拒绝原因 |

**示例：**
```bash
# 标记为待审核
curl -X PUT \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status":"pending","resource_id":123}' \
  http://localhost:8888/api/v1/files/1/approval

# 审核通过
curl -X PUT \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}' \
  http://localhost:8888/api/v1/files/1/approval

# 审核拒绝（带原因）
curl -X PUT \
  -H "Authorization: Bearer dk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"status":"rejected","reject_reason":"内容不符合社区规范"}' \
  http://localhost:8888/api/v1/files/1/approval
```

**响应：**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "approval_status": "approved"
  }
}
```

### 3.8 上传时设置审核状态

上传接口支持通过 query 参数在上传时直接设置审核状态：

```
POST /api/v1/files/upload?category=docs&approval_status=pending&approval_source=mindforum&resource_id=123
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `approval_status` | string | 初始审核状态（通常为 `pending`） |
| `approval_source` | string | 来源标识（如 `mindforum`） |
| `resource_id` | number | 关联的外部资源 ID |

上传响应中会返回文件 ID：
```json
{
  "message": "成功上传 1 个文件",
  "files": [
    {
      "id": 45,
      "file_name": "document.pdf",
      "file_path": "docs/document.pdf",
      "file_size": 204800
    }
  ]
}
```

---

## 五、完整调用示例

### Python

```python
import requests

API_BASE = "http://localhost:8888/api/v1"
API_KEY = "dk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

headers = {"Authorization": f"Bearer {API_KEY}"}

# 查询文件列表
resp = requests.get(f"{API_BASE}/files", headers=headers)
files = resp.json()["data"]["files"]

# 上传文件
with open("report.pdf", "rb") as f:
    resp = requests.post(
        f"{API_BASE}/files/upload?category=documents",
        headers=headers,
        files=[("files", ("report.pdf", f, "application/pdf"))],
    )

# 删除文件
resp = requests.delete(f"{API_BASE}/files/1", headers=headers)
```

### JavaScript (Node.js)

```javascript
const API_BASE = 'http://localhost:8888/api/v1';
const API_KEY = 'dk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

const headers = { 'Authorization': `Bearer ${API_KEY}` };

// 查询文件列表
const res = await fetch(`${API_BASE}/files`, { headers });
const { data } = await res.json();

// 上传文件
const formData = new FormData();
formData.append('files', fs.createReadStream('report.pdf'));
await fetch(`${API_BASE}/files/upload?category=documents`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${API_KEY}` },
  body: formData,
});

// 删除文件
await fetch(`${API_BASE}/files/1`, {
  method: 'DELETE',
  headers,
});
```

### cURL

```bash
API_KEY="dk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
BASE="http://localhost:8888/api/v1"

# 查询
curl -H "Authorization: Bearer $API_KEY" "$BASE/files"

# 上传
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -F "files=@report.pdf" \
  "$BASE/files/upload?category=documents"

# 更新
curl -X PUT -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"项目说明文档"}' \
  "$BASE/files/1"

# 删除
curl -X DELETE -H "Authorization: Bearer $API_KEY" "$BASE/files/1"

# 批量删除
curl -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ids":[1,2,3]}' \
  "$BASE/files/batch-delete"
```

---

## 六、安全建议

1. **最小权限原则** — 仅需查询的场景使用 `read` 权限的 Key
2. **及时撤销** — 不再使用的 Key 应在后台撤销
3. **保密存储** — API Key 等同于密码，不要提交到代码仓库或日志中
4. **HTTPS** — 生产环境务必启用 HTTPS，防止 Key 在网络传输中被截获

---

*文档更新时间：2026-07-13*
