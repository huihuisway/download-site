const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { config } = require('../config');
const { MAX_FILE_SIZE } = require('../config/constants');
const { db } = require('../db');
const { sanitizeFilename, isAllowedExtension, ensureInSandbox } = require('../utils/filename');
const { guessMimeType } = require('./sync.service');

// multer 存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 优先从 query 参数读取分类（解决 multipart 中 text 字段在 files 之后到达的问题）
    const category = req.query.category || req.body.category || req.params.category || 'uncategorized';
    const safeCategory = sanitizeFilename(category);
    const destDir = path.join(config.downloadDir, safeCategory);

    try {
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

    const category = req.query.category || req.body.category || 'uncategorized';
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
    SET file_name = ?, file_path = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(safeName, newRelativePath, fileId);

  return { old_path: record.file_path, new_path: newRelativePath, new_name: safeName };
};

const updateDescription = (fileId, description) => {
  const result = db.prepare(`
    UPDATE download_logs
    SET description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(description || null, fileId);

  if (result.changes === 0) {
    throw new Error('文件记录不存在');
  }

  return { updated: true };
};

const moveFile = (fileId, newCategory) => {
  const safeCategory = sanitizeFilename(newCategory);
  const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(fileId);
  if (!record) {
    throw new Error('文件记录不存在');
  }

  const oldFullPath = path.join(config.downloadDir, record.file_path);
  ensureInSandbox(oldFullPath);

  const newDir = path.join(config.downloadDir, safeCategory);
  fs.mkdirSync(newDir, { recursive: true });

  const newFullPath = path.join(newDir, record.file_name);
  ensureInSandbox(newFullPath);

  if (fs.existsSync(newFullPath)) {
    throw new Error('目标分类下已存在同名文件');
  }

  fs.renameSync(oldFullPath, newFullPath);

  const newRelativePath = path.relative(config.downloadDir, newFullPath).replace(/\\/g, '/');
  db.prepare(`
    UPDATE download_logs
    SET file_path = ?, category = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(newRelativePath, safeCategory, fileId);

  return { old_path: record.file_path, new_path: newRelativePath, new_category: safeCategory };
};

const createCategory = (categoryName) => {
  const safeName = sanitizeFilename(categoryName);
  const dirPath = path.join(config.downloadDir, safeName);
  ensureInSandbox(dirPath);

  fs.mkdirSync(dirPath, { recursive: true });
  return { category: safeName, path: dirPath };
};

const deleteCategory = (categoryName) => {
  const safeName = sanitizeFilename(categoryName);
  const dirPath = path.join(config.downloadDir, safeName);
  ensureInSandbox(dirPath);

  // 检查是否有文件
  const fileCount = db.prepare('SELECT COUNT(*) as count FROM download_logs WHERE category = ?').get(safeName);
  if (fileCount.count > 0) {
    throw new Error(`分类 "${safeName}" 下还有 ${fileCount.count} 个文件，请先删除文件`);
  }

  if (fs.existsSync(dirPath)) {
    fs.rmdirSync(dirPath);
  }

  return { deleted: safeName };
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

  // 补充没有文件的物理目录
  if (fs.existsSync(config.downloadDir)) {
    const dirs = fs.readdirSync(config.downloadDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      if (!categories.find((c) => c.category === dir)) {
        categories.push({
          category: dir,
          file_count: 0,
          total_size: 0,
          total_downloads: 0,
        });
      }
    }
  }

  return categories;
};

module.exports = {
  upload,
  uploadFiles,
  deleteFile,
  batchDelete,
  renameFile,
  updateDescription,
  moveFile,
  createCategory,
  deleteCategory,
  getCategories,
};
