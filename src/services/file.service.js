const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { config } = require('../config');
const { MAX_FILE_SIZE } = require('../config/constants');
const { db } = require('../db');
const { sanitizeFilename, isAllowedExtension, ensureInSandbox } = require('../utils/filename');
const { guessMimeType } = require('./sync.service');
const folderTreeService = require('./folder-tree.service');

const getUploadFolderPath = (req) => {
  const rawFolderPath = req.query.category || req.body.category || req.params.category || '';
  const normalized = folderTreeService.normalizeFolderPath(rawFolderPath);
  return normalized === 'root' ? '' : normalized;
};

// multer 存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderPath = getUploadFolderPath(req);
    const destDir = folderPath ? path.join(config.downloadDir, folderPath) : config.downloadDir;

    try {
      ensureInSandbox(destDir);
      fs.mkdirSync(destDir, { recursive: true });
      cb(null, destDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    try {
      const safeName = sanitizeFilename(file.originalname);
      if (!safeName || safeName === '.' || safeName === '..') {
        return cb(new Error('无效的文件名'));
      }
      cb(null, safeName);
    } catch (err) {
      cb(err);
    }
  },
});

const fileFilter = (req, file, cb) => {
  if (!isAllowedExtension(file.originalname)) {
    return cb(new Error(`不允许的文件类型: ${path.extname(file.originalname)}`), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 20,
    // 限制 multipart 字段名嵌套深度，修复 CVE-2026-5079 DoS 漏洞
    fieldNestingDepth: 5,
  },
});

const uploadFiles = (req, res, extraFields = {}) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件大小超出限制' });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未选择文件' });
    }

    const uploadedBy = req.session?.user?.id || null;

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO download_logs
        (file_name, file_path, category, file_size, mime_type, file_mtime, uploaded_by, approval_status, approval_source, approval_resource_id)
      VALUES
        (@file_name, @file_path, @category, @file_size, @mime_type, @file_mtime, @uploaded_by, @approval_status, @approval_source, @approval_resource_id)
    `);

    const results = [];

    const insertTransaction = db.transaction(() => {
      for (const file of req.files) {
        const relativePath = path.relative(config.downloadDir, file.path).replace(/\\/g, '/');
        const stat = fs.statSync(file.path);
        const mime = guessMimeType(file.originalname);
        const category = folderTreeService.getParentFolderPath(relativePath);

        const insertResult = insertStmt.run({
          file_name: file.filename,
          file_path: relativePath,
          category,
          file_size: stat.size,
          mime_type: mime,
          file_mtime: stat.mtime.toISOString(),
          uploaded_by: uploadedBy,
          approval_status: extraFields.approval_status || null,
          approval_source: extraFields.approval_source || null,
          approval_resource_id: extraFields.approval_resource_id || null,
        });

        results.push({
          id: insertResult.lastInsertRowid,
          file_name: file.filename,
          file_path: relativePath,
          file_size: stat.size,
        });
      }
    });

    insertTransaction();

    return res.json({
      message: `成功上传 ${results.length} 个文件`,
      files: results,
    });
  });
};

const deleteFile = (fileId) => {
  const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(fileId);
  if (!record) {
    throw new Error('文件记录不存在');
  }

  const fullPath = path.join(config.downloadDir, record.file_path);
  ensureInSandbox(fullPath);

  // 删除物理文件
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  // 删除 DB 记录
  db.prepare('DELETE FROM download_logs WHERE id = ?').run(fileId);

  return { deleted: record.file_path };
};

const batchDelete = (ids) => {
  const { MAX_BATCH_SIZE } = require('../config/constants');
  if (ids.length > MAX_BATCH_SIZE) {
    throw new Error(`批量删除不能超过 ${MAX_BATCH_SIZE} 个`);
  }

  const deleted = [];
  const errors = [];

  const deleteTransaction = db.transaction(() => {
    for (const id of ids) {
      try {
        const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(id);
        if (!record) {
          errors.push({ id, error: '记录不存在' });
          continue;
        }

        const fullPath = path.join(config.downloadDir, record.file_path);
        ensureInSandbox(fullPath);

        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }

        db.prepare('DELETE FROM download_logs WHERE id = ?').run(id);
        deleted.push(record.file_path);
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }
  });

  deleteTransaction();
  return { deleted, errors };
};

const renameFile = (fileId, newName) => {
  const safeName = sanitizeFilename(newName);
  const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(fileId);
  if (!record) {
    throw new Error('文件记录不存在');
  }

  const oldFullPath = path.join(config.downloadDir, record.file_path);
  ensureInSandbox(oldFullPath);

  const dir = path.dirname(oldFullPath);
  const newFullPath = path.join(dir, safeName);
  ensureInSandbox(newFullPath);

  if (fs.existsSync(newFullPath)) {
    throw new Error('目标文件名已存在');
  }

  // 重命名物理文件
  fs.renameSync(oldFullPath, newFullPath);

  // 更新 DB
  const newRelativePath = path.relative(config.downloadDir, newFullPath).replace(/\\/g, '/');
  db.prepare(`
    UPDATE download_logs
    SET file_name = @file_name, file_path = @file_path, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ file_name: safeName, file_path: newRelativePath, id: fileId });

  return { old_path: record.file_path, new_path: newRelativePath, new_name: safeName };
};

const updateDescription = (fileId, description) => {
  const result = db.prepare(`
    UPDATE download_logs
    SET description = @description, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ description: description || null, id: fileId });

  if (result.changes === 0) {
    throw new Error('文件记录不存在');
  }

  return { updated: true };
};

const moveFile = (fileId, folderPath) => {
  const normalized = folderTreeService.normalizeFolderPath(folderPath);
  const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(fileId);
  if (!record) {
    throw new Error('文件记录不存在');
  }

  const oldFullPath = path.join(config.downloadDir, record.file_path);
  ensureInSandbox(oldFullPath);

  const newDir = normalized === 'root' ? config.downloadDir : path.join(config.downloadDir, normalized);
  fs.mkdirSync(newDir, { recursive: true });

  const newFullPath = path.join(newDir, record.file_name);
  ensureInSandbox(newFullPath);

  if (fs.existsSync(newFullPath)) {
    throw new Error('目标目录下已存在同名文件');
  }

  fs.renameSync(oldFullPath, newFullPath);

  const newRelativePath = path.relative(config.downloadDir, newFullPath).replace(/\\/g, '/');
  const newCategory = folderTreeService.getParentFolderPath(newRelativePath);

  db.prepare(`
    UPDATE download_logs
    SET file_path = @file_path, category = @category, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ file_path: newRelativePath, category: newCategory, id: fileId });

  return { old_path: record.file_path, new_path: newRelativePath, new_category: newCategory };
};

const createFolder = (folderPath) => {
  const normalized = folderTreeService.normalizeFolderPath(folderPath);
  if (normalized === 'root') {
    throw new Error('不能创建根目录');
  }
  const fullPath = path.join(config.downloadDir, normalized);
  ensureInSandbox(fullPath);
  fs.mkdirSync(fullPath, { recursive: true });
  return { folder: normalized };
};

const renameFolder = (folderPath, newName) => {
  const normalized = folderTreeService.normalizeFolderPath(folderPath);
  if (normalized === 'root') {
    throw new Error('不能重命名根目录');
  }

  const safeNewName = sanitizeFilename(newName);
  const parentPath = folderTreeService.getParentFolderPath(normalized);
  const newPath = parentPath === 'root' ? safeNewName : `${parentPath}/${safeNewName}`;

  const oldFullPath = path.join(config.downloadDir, normalized);
  const newFullPath = path.join(config.downloadDir, newPath);

  ensureInSandbox(oldFullPath);
  ensureInSandbox(newFullPath);

  if (!fs.existsSync(oldFullPath)) {
    throw new Error(`目录 "${normalized}" 不存在`);
  }
  if (fs.existsSync(newFullPath)) {
    throw new Error(`目标目录 "${newPath}" 已存在`);
  }

  fs.renameSync(oldFullPath, newFullPath);

  // Update all files under the renamed folder (filter in JS since JSON DB doesn't support LIKE)
  const allFiles = db.prepare('SELECT id, file_path FROM download_logs').all();
  const matchingFiles = allFiles.filter((f) => f.file_path && f.file_path.startsWith(normalized + '/'));
  let movedFiles = 0;

  const updateStmt = db.prepare('UPDATE download_logs SET file_path = @file_path, category = @category WHERE id = @id');
  const updateTransaction = db.transaction(() => {
    for (const file of matchingFiles) {
      const newFilePath = newPath + file.file_path.slice(normalized.length);
      const newCategory = folderTreeService.getParentFolderPath(newFilePath);
      updateStmt.run({ file_path: newFilePath, category: newCategory, id: file.id });
      movedFiles++;
    }
  });
  updateTransaction();

  return { old_path: normalized, new_path: newPath, moved_files: movedFiles };
};

const deleteFolder = (folderPath, options = {}) => {
  const { recursive = false } = options;
  const normalized = folderTreeService.normalizeFolderPath(folderPath);

  if (normalized === 'root') {
    throw new Error('不能删除根目录');
  }

  const fullPath = path.join(config.downloadDir, normalized);
  ensureInSandbox(fullPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`目录 "${normalized}" 不存在`);
  }

  // Find all files under this folder (filter in JS since JSON DB doesn't support LIKE)
  const allFiles = db.prepare('SELECT id, file_path FROM download_logs').all();
  const filesUnderFolder = allFiles.filter((f) => f.file_path && f.file_path.startsWith(normalized + '/'));

  if (filesUnderFolder.length > 0 && !recursive) {
    throw new Error(`目录 "${normalized}" 下还有 ${filesUnderFolder.length} 个文件，请先删除文件或启用递归删除`);
  }

  // Check for subfolders
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const subfolders = physicalFolders.filter((f) => f.startsWith(normalized + '/'));

  if (subfolders.length > 0 && !recursive) {
    throw new Error(`目录 "${normalized}" 下还有子目录，请启用递归删除`);
  }

  const deletedFolders = [normalized, ...subfolders];
  const deletedFiles = [];

  const deleteTransaction = db.transaction(() => {
    // Delete physical files
    for (const file of filesUnderFolder) {
      const filePath = path.join(config.downloadDir, file.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedFiles.push(file.file_path);
      }
      db.prepare('DELETE FROM download_logs WHERE id = ?').run(file.id);
    }

    // Delete physical folders (deepest first)
    const sortedFolders = [...deletedFolders].sort((a, b) => b.length - a.length);
    for (const folder of sortedFolders) {
      const folderFullPath = path.join(config.downloadDir, folder);
      if (fs.existsSync(folderFullPath)) {
        try {
          fs.rmdirSync(folderFullPath);
        } catch {
          // Ignore if already deleted
        }
      }
    }
  });

  deleteTransaction();

  return { deleted_folders: deletedFolders, deleted_files: deletedFiles };
};

const createCategory = createFolder;

const deleteCategory = (categoryName) => {
  const normalized = folderTreeService.normalizeFolderPath(categoryName);
  return deleteFolder(normalized, { recursive: false });
};

const getCategories = () => {
  const categories = db.prepare(`
    SELECT
      category,
      COUNT(*) as file_count,
      SUM(file_size) as total_size,
      SUM(download_count) as total_downloads
    FROM download_logs
    GROUP BY category
    ORDER BY category
  `).all();

  const categoryMap = new Map(categories.map((category) => [category.category, category]));

  for (const folderPath of folderTreeService.listPhysicalFolders(config.downloadDir)) {
    if (!categoryMap.has(folderPath)) {
      const emptyCategory = {
        category: folderPath,
        file_count: 0,
        total_size: 0,
        total_downloads: 0,
      };
      categories.push(emptyCategory);
      categoryMap.set(folderPath, emptyCategory);
    }
  }

  return categories.sort((a, b) => a.category.localeCompare(b.category));
};

module.exports = {
  upload,
  uploadFiles,
  deleteFile,
  batchDelete,
  renameFile,
  updateDescription,
  moveFile,
  createFolder,
  deleteFolder,
  renameFolder,
  createCategory,
  deleteCategory,
  getCategories,
};

