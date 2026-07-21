# Multi-Level Folder Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the download site from single-level categories to fully navigable multi-level folders across both public browsing and admin management.

**Architecture:** Treat `file_path` as the source of truth and redefine `category` to mean the full parent directory path instead of just the first segment. Add one deep path-and-tree module that normalizes directory paths, derives tree entries and breadcrumbs from file records plus physical directories, and centralizes empty-folder visibility so public and admin behavior stay consistent.

**Tech Stack:** Node.js, Express, EJS, React, node:test, filesystem-backed session/file storage

## Global Constraints

- Public and admin both support multi-level folders.
- Public directory pages show only direct child folders and direct files for the current folder.
- Public folder pages use breadcrumb navigation and a "go up" action.
- Empty folders are visible in both public and admin.
- Public access to an empty folder renders a normal empty-folder page, not a redirect or 404.
- Admin upload chooses from existing folders only; no free-text target path entry in the upload flow.
- Admin can manually create new folders.
- Folder deletion supports both empty-folder delete and recursive delete of the full subtree.
- Folder rename is supported; whole-folder move is not supported.
- Renaming a folder updates the full subtree beneath it.
- Moving a file does not auto-clean empty source folders.
- Public multi-level folder URLs use path-style URLs like `/category/docs/guides/v1`.
- Keep file page and download behavior rooted in full `file_path`.

---

## File Structure

**Backend path/tree seam**
- Modify: `src/utils/filename.js`
  - Expand path normalization helpers so callers stop hand-parsing folder segments.
- Create: `src/services/folder-tree.service.js`
  - Deep module for folder path normalization, breadcrumb derivation, direct-child listing, empty-folder discovery, subtree membership, and rename/delete planning.

**Backend public/admin behavior**
- Modify: `src/routes/public.js`
  - Switch public browsing from one-level category pages to path-based folder pages using the folder-tree module.
- Modify: `src/services/file.service.js`
  - Accept full folder paths for create/move/upload and add folder rename / recursive delete operations.
- Modify: `src/services/stats.service.js`
  - Filter and list files by full folder path semantics rather than flat categories.
- Modify: `src/routes/admin.js`
  - Expose folder-tree-aware admin endpoints for create/delete/rename and file moves.

**Frontend admin behavior**
- Modify: `admin/src/api/client.js`
  - Add folder rename / recursive delete / folder tree fetch methods if needed.
- Modify: `admin/src/pages/Categories.jsx`
  - Replace flat category cards with first-level-expanded folder tree and folder operations.
- Modify: `admin/src/pages/FileManager.jsx`
  - Replace flat category selection with existing-folder picker and full-path display/filtering.

**Verification**
- Modify: `tests/auth.test.js` only if route guards need path updates.
- Modify: `tests/public-routes.test.js`
  - Add nested folder browsing, breadcrumb, and empty-folder coverage.
- Modify: `tests/local-login.test.js` only if admin path behavior changes request expectations.
- Create or modify focused service tests for folder tree / file service behavior.

---

### Task 1: Establish canonical folder-path behavior

**Files:**
- Modify: `src/utils/filename.js`
- Create: `src/services/folder-tree.service.js`
- Test: `tests/folder-tree.test.js`

**Interfaces:**
- Consumes: `download_logs.file_path: string`, physical folder paths under `config.downloadDir`
- Produces:
  - `normalizeFolderPath(input): string`
  - `getParentFolderPath(filePath): string`
  - `listFolderEntries({ currentPath, files, physicalFolders }): { currentPath: string, parentPath: string | null, breadcrumbs: Array<{ name: string, path: string }>, directories: Array<{ path: string, name: string, isEmpty: boolean }>, files: Array<object>, isEmpty: boolean }`
  - `listFolderTree({ files, physicalFolders }): Array<{ path: string, name: string, depth: number, hasChildren: boolean, fileCount: number }>`
  - `listSubtreePaths(folderPath, physicalFolders): string[]`

- [ ] **Step 1: Write the failing folder-tree test file**

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeFolderPath,
  getParentFolderPath,
  listFolderEntries,
} = require('../src/services/folder-tree.service');

describe('folder tree service', () => {
  const files = [
    { file_name: 'readme.pdf', file_path: 'docs/guides/v1/readme.pdf', category: 'docs/guides/v1' },
    { file_name: 'changelog.txt', file_path: 'docs/guides/v1/changelog.txt', category: 'docs/guides/v1' },
    { file_name: 'banner.png', file_path: 'assets/images/banner.png', category: 'assets/images' },
  ];
  const physicalFolders = ['docs', 'docs/guides', 'docs/guides/v1', 'docs/empty', 'assets', 'assets/images'];

  it('应将目录路径规范化为统一格式', () => {
    assert.strictEqual(normalizeFolderPath('docs/guides/'), 'docs/guides');
    assert.strictEqual(normalizeFolderPath('/docs//guides/v1'), 'docs/guides/v1');
    assert.strictEqual(normalizeFolderPath(''), 'root');
  });

  it('应从文件路径推导完整父目录', () => {
    assert.strictEqual(getParentFolderPath('docs/guides/v1/readme.pdf'), 'docs/guides/v1');
    assert.strictEqual(getParentFolderPath('readme.pdf'), 'root');
  });

  it('目录页只返回直接子目录和当前目录文件', () => {
    const result = listFolderEntries({ currentPath: 'docs', files, physicalFolders });
    assert.deepStrictEqual(result.directories.map((d) => d.path), ['docs/empty', 'docs/guides']);
    assert.deepStrictEqual(result.files.map((f) => f.file_path), []);
    assert.deepStrictEqual(result.breadcrumbs, [
      { name: '首页', path: 'root' },
      { name: 'docs', path: 'docs' },
    ]);
  });

  it('空目录页应被识别为可访问且为空', () => {
    const result = listFolderEntries({ currentPath: 'docs/empty', files, physicalFolders });
    assert.strictEqual(result.isEmpty, true);
    assert.deepStrictEqual(result.directories, []);
    assert.deepStrictEqual(result.files, []);
  });
});
```

- [ ] **Step 2: Run the focused folder-tree tests and confirm failure**

Run: `node --test tests/folder-tree.test.js`
Expected: FAIL with module/function missing errors.

- [ ] **Step 3: Implement the canonical path-and-tree module**

```js
// src/services/folder-tree.service.js
const normalizeFolderPath = (input) => {
  const raw = typeof input === 'string' ? input : '';
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  return normalized || 'root';
};

const getParentFolderPath = (filePath) => {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return 'root';
  return parts.slice(0, -1).join('/');
};
```

Implement the rest of the module in the same file so all directory semantics live behind one seam.

- [ ] **Step 4: Update filename helpers to delegate category derivation to full parent path**

```js
const { getParentFolderPath } = require('../services/folder-tree.service');

const getCategoryFromPath = (relativePath) => getParentFolderPath(relativePath);
```

- [ ] **Step 5: Re-run the focused tests**

Run: `node --test tests/folder-tree.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/filename.js src/services/folder-tree.service.js tests/folder-tree.test.js
git commit -m "feat: add canonical folder tree module"
```

### Task 2: Upgrade public browsing to nested folders

**Files:**
- Modify: `src/routes/public.js`
- Modify: representative public EJS templates under `src/views/themes/*/index.ejs` and `src/views/themes/*/category.ejs`
- Test: `tests/public-routes.test.js`

**Interfaces:**
- Consumes:
  - `listFolderEntries({ currentPath, files, physicalFolders })`
  - `normalizeFolderPath(input)`
- Produces:
  - Public folder pages at `/category/*`
  - View model with `breadcrumbs`, `parentPath`, `directories`, `files`, `isEmpty`

- [ ] **Step 1: Add failing public-route tests for nested folders and empty folders**

```js
it('GET /category/docs/guides 应只显示直接子目录', async () => {
  const response = await request(server, '/category/docs/guides');
  assert.strictEqual(response.statusCode, 200);
  assert.match(response.body, /docs\/guides\/v1/);
  assert.doesNotMatch(response.body, /banner\.png/);
});

it('GET /category/docs/empty 应显示空目录页', async () => {
  const response = await request(server, '/category/docs/empty');
  assert.strictEqual(response.statusCode, 200);
  assert.match(response.body, /此目录为空/);
});
```

- [ ] **Step 2: Run the public route tests to confirm failure**

Run: `node --test tests/public-routes.test.js`
Expected: FAIL because the current router only supports `/category/:category`.

- [ ] **Step 3: Replace one-level category queries with path-aware directory rendering**

```js
router.get(['/category', '/category/*'], (req, res) => {
  const currentPath = normalizeFolderPath(req.params[0] || 'root');
  const files = db.prepare('SELECT * FROM download_logs ORDER BY file_path ASC').all();
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const directory = folderTreeService.listFolderEntries({ currentPath, files, physicalFolders });

  return renderTheme(res, 'category', {
    title: `${directory.currentPath === 'root' ? '目录' : directory.currentPath} - ${siteInfo.site_name}`,
    currentPath: directory.currentPath,
    parentPath: directory.parentPath,
    breadcrumbs: directory.breadcrumbs,
    directories: directory.directories,
    files: directory.files,
    isEmpty: directory.isEmpty,
  });
});
```

- [ ] **Step 4: Update each theme’s category/index view model usage**

Use one representative snippet pattern per theme:

```ejs
<% if (breadcrumbs && breadcrumbs.length) { %>
  <nav class="...">
    <% for (const crumb of breadcrumbs) { %>
      <a href="<%= crumb.path === 'root' ? '/' : '/category/' + crumb.path %>"><%= crumb.name %></a>
    <% } %>
  </nav>
<% } %>

<% if (directories.length) { %>
  <% for (const dir of directories) { %>
    <a href="/category/<%= dir.path %>"><%= dir.name %></a>
  <% } %>
<% } %>
```

- [ ] **Step 5: Re-run the focused public route tests**

Run: `node --test tests/public-routes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/public.js src/views/themes tests/public-routes.test.js
git commit -m "feat: add nested public folder browsing"
```

### Task 3: Make file and folder operations path-aware in the backend

**Files:**
- Modify: `src/services/file.service.js`
- Modify: `src/services/stats.service.js`
- Modify: `src/routes/admin.js`
- Test: `tests/file-service.test.js`

**Interfaces:**
- Consumes:
  - `normalizeFolderPath(input): string`
  - `getParentFolderPath(filePath): string`
  - `listSubtreePaths(folderPath, physicalFolders): string[]`
- Produces:
  - `createFolder(folderPath): { folder: string }`
  - `renameFolder(folderPath, newName): { old_path: string, new_path: string, moved_files: number }`
  - `deleteFolder(folderPath, { recursive }): { deleted_folders: string[], deleted_files: string[] }`
  - `moveFile(fileId, folderPath)` using full folder paths

- [ ] **Step 1: Write failing file-service tests for nested folder operations**

```js
it('应以完整父目录路径保存 category', () => {
  const category = getParentFolderPath('docs/guides/v1/readme.pdf');
  assert.strictEqual(category, 'docs/guides/v1');
});

it('重命名目录时应更新整个子树文件路径', () => {
  const result = fileService.renameFolder('docs/guides', 'manuals');
  assert.strictEqual(result.new_path, 'docs/manuals');
  assert.strictEqual(statsService.getFileByPath('docs/manuals/v1/readme.pdf').file_name, 'readme.pdf');
});
```

- [ ] **Step 2: Run the focused service tests and confirm failure**

Run: `node --test tests/file-service.test.js`
Expected: FAIL because folder operations do not exist yet.

- [ ] **Step 3: Implement full-path file/folder operations in `file.service.js`**

Key implementation targets:

```js
const createFolder = (folderPath) => {
  const normalized = normalizeFolderPath(folderPath);
  const fullPath = normalized === 'root' ? config.downloadDir : path.join(config.downloadDir, normalized);
  ensureInSandbox(fullPath);
  fs.mkdirSync(fullPath, { recursive: true });
  return { folder: normalized };
};
```

Also implement:
- `renameFolder(folderPath, newName)` with subtree DB updates
- `deleteFolder(folderPath, { recursive })`
- `moveFile(fileId, folderPath)` using normalized full folder path
- upload destination based on selected existing folder path

- [ ] **Step 4: Expose admin endpoints for nested folder operations**

Representative route shape:

```js
router.post('/folders', (req, res) => {
  const result = fileService.createFolder(req.body.path);
  res.json(result);
});

router.put('/folders/rename', (req, res) => {
  const result = fileService.renameFolder(req.body.path, req.body.newName);
  res.json(result);
});

router.post('/folders/delete', (req, res) => {
  const result = fileService.deleteFolder(req.body.path, { recursive: !!req.body.recursive });
  res.json(result);
});
```

- [ ] **Step 5: Re-run focused service tests**

Run: `node --test tests/file-service.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/file.service.js src/services/stats.service.js src/routes/admin.js tests/file-service.test.js
git commit -m "feat: support nested folder admin operations"
```

### Task 4: Upgrade admin UI from flat categories to folder tree management

**Files:**
- Modify: `admin/src/api/client.js`
- Modify: `admin/src/pages/Categories.jsx`
- Modify: `admin/src/pages/FileManager.jsx`
- Test: `tests/local-login.test.js`

**Interfaces:**
- Consumes:
  - `api.getCategories()` or new `api.getFolders()` returning tree entries
  - `api.createFolder(path)`
  - `api.renameFolder(path, newName)`
  - `api.deleteFolder(path, recursive)`
  - `api.moveFile(id, folderPath)`
- Produces:
  - First-level-expanded folder tree UI
  - Existing-folder-only upload target picker
  - Recursive delete confirmation flow

- [ ] **Step 1: Add failing integration-style coverage for folder-aware admin responses**

```js
it('本地管理员应能读取目录树接口', async () => {
  const res = await request(server, { path: '/api/admin/categories', headers: { Cookie: cookie } });
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /docs\/guides/);
});
```

- [ ] **Step 2: Run the relevant admin tests and confirm missing tree semantics**

Run: `node --test tests/local-login.test.js`
Expected: FAIL or lack the required folder tree assertions.

- [ ] **Step 3: Replace the flat category UI with tree-oriented management**

Representative UI expectations:

```jsx
<FolderTreeView
  items={folders}
  defaultExpandedDepth={1}
  onRename={handleRenameFolder}
  onDeleteEmpty={handleDeleteEmptyFolder}
  onDeleteRecursive={handleDeleteRecursiveFolder}
/>
```

And in upload modal:

```jsx
<FolderPicker
  folders={folders}
  value={folderPath}
  onChange={setFolderPath}
/>
```

No free-text upload target input remains.

- [ ] **Step 4: Add strong confirmations for recursive delete only**

```jsx
if (!confirm(`确认递归删除目录 "${path}" 及其全部子目录和文件？`)) return;
```

- [ ] **Step 5: Re-run the local login/admin tests**

Run: `node --test tests/local-login.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add admin/src/api/client.js admin/src/pages/Categories.jsx admin/src/pages/FileManager.jsx tests/local-login.test.js
git commit -m "feat: add nested folder admin UI"
```

### Task 5: Final compatibility pass and full verification

**Files:**
- Modify: `tests/public-routes.test.js`
- Modify: `tests/local-login.test.js`
- Modify: representative docs/config references if needed

**Interfaces:**
- Consumes: all new folder-tree-aware backend and frontend behavior
- Produces: full regression coverage for nested public browsing, admin folder management, empty-folder visibility, and path-style URLs

- [ ] **Step 1: Add final end-to-end assertions for the chosen product behavior**

Required assertions to include:

```js
assert.match(response.body, /首页/);
assert.match(response.body, /返回上一级/);
assert.match(response.body, /此目录为空/);
assert.strictEqual(deleteEmpty.statusCode, 200);
assert.strictEqual(deleteRecursive.statusCode, 200);
```

- [ ] **Step 2: Run focused route/admin tests**

Run: `node --test tests/public-routes.test.js tests/local-login.test.js`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Check for doc/config drift in user-facing examples**

Update representative wording so the product no longer claims “分类 = 一级目录”.

- [ ] **Step 5: Commit**

```bash
git add tests/public-routes.test.js tests/local-login.test.js docs .env.example
git commit -m "test: verify nested folder browsing end to end"
```

## Self-Review

- Spec coverage: public nested browsing, breadcrumb/up navigation, empty-folder visibility, admin create/rename/delete behaviors, no folder move, existing-folder upload target, and path-style URLs are all mapped to tasks.
- Placeholder scan: no `TODO`/`TBD` markers remain.
- Type consistency: `category` is consistently treated as full parent folder path and all later tasks consume the folder-tree module interfaces defined in Task 1.
