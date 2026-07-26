const { db } = require('../db');
const { config } = require('../config');
const { CHECKSUM_BATCH_SIZE } = require('../config/constants');
const fsp = require('fs').promises;
const path = require('path');
const folderTreeService = require('./folder-tree.service');

const getAllPhysicalFiles = async () => {
  const files = [];

  const scanDir = async (dir, relativeBase = '') => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`扫描目录失败: ${dir} (${err.message})`);
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await scanDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        files.push({
          file_name: entry.name,
          file_path: normalizedPath,
          category: folderTreeService.getParentFolderPath(normalizedPath),
          file_size: stat.size,
          file_mtime: stat.mtime.toISOString(),
          full_path: fullPath,
        });
      }
    }
  };

  await scanDir(config.downloadDir);
  return files;
};

const getAllDbRecords = () => {
  return db.prepare('SELECT * FROM download_logs').all();
};

const syncDirectory = async () => {
  const physicalFiles = await getAllPhysicalFiles();
  const dbRecords = getAllDbRecords();

  const dbPathMap = new Map();
  for (const record of dbRecords) {
    dbPathMap.set(record.file_path, record);
  }

  const physicalPathSet = new Set(physicalFiles.map((f) => f.file_path));

  const upsertStmt = db.prepare(`
    INSERT INTO download_logs (file_name, file_path, category, file_size, file_mtime, mime_type)
    VALUES (@file_name, @file_path, @category, @file_size, @file_mtime, @mime_type)
    ON CONFLICT(file_path) DO UPDATE SET
      file_name = @file_name,
      file_size = @file_size,
      file_mtime = @file_mtime,
      category = @category,
      updated_at = CURRENT_TIMESTAMP
  `);

  const updateMtimeStmt = db.prepare(`
    UPDATE download_logs
    SET file_size = @file_size,
        file_mtime = @file_mtime,
        sha256 = NULL,
        category = @category,
        updated_at = CURRENT_TIMESTAMP
    WHERE file_path = @file_path
  `);

  const deleteStmt = db.prepare('DELETE FROM download_logs WHERE file_path = ?');

  const syncTransaction = db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    const needsChecksum = [];

    for (let i = 0; i < physicalFiles.length; i++) {
      const file = physicalFiles[i];
      const existing = dbPathMap.get(file.file_path);

      if (!existing) {
        const mime = guessMimeType(file.file_name);
        upsertStmt.run({
          ...file,
          mime_type: mime,
        });
        inserted++;
        needsChecksum.push(file.file_path);
      } else if (existing.file_mtime !== file.file_mtime || existing.category !== file.category) {
        updateMtimeStmt.run({
          file_size: file.file_size,
          file_mtime: file.file_mtime,
          file_path: file.file_path,
          category: file.category,
        });
        updated++;
        needsChecksum.push(file.file_path);
      }
    }

    for (const record of dbRecords) {
      if (!physicalPathSet.has(record.file_path)) {
        deleteStmt.run(record.file_path);
        deleted++;
      }
    }

    return { inserted, updated, deleted, needsChecksum };
  });

  const result = syncTransaction();
  folderTreeService.invalidateFolderCache();  // 同步后目录结构可能已变化

  if (result.needsChecksum.length > 0 && process.env.NODE_ENV !== 'test') {
    scheduleChecksumComputation(result.needsChecksum);
  }

  return result;
};

/**
 * 后台计算 SHA256（fire-and-forget，不阻塞调用方）
 * 用流式哈希：大文件不再一次性读入内存，批次之间让出事件循环
 */
const scheduleChecksumComputation = (filePaths) => {
  const { computeChecksum } = require('./checksum.service');
  const updateStmt = db.prepare('UPDATE download_logs SET sha256 = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?');

  const run = async () => {
    for (let i = 0; i < filePaths.length; i += CHECKSUM_BATCH_SIZE) {
      const batch = filePaths.slice(i, i + CHECKSUM_BATCH_SIZE);
      for (const filePath of batch) {
        try {
          const hash = await computeChecksum(path.join(config.downloadDir, filePath));
          updateStmt.run(hash, filePath);
        } catch (err) {
          console.error(`[sync] SHA256 计算失败: ${filePath}`, err.message);
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  run().catch((err) => console.error('[sync] 校验计算任务失败:', err.message));
};

const guessMimeType = (filename) => {
  const ext = require('path').extname(filename).toLowerCase();
  const mimeMap = {
    '.zip': 'application/zip',
    '.iso': 'application/x-iso9660-image',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
    '.7z': 'application/x-7z-compressed',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.md': 'text/markdown',
    '.jar': 'application/java-archive',
  };
  return mimeMap[ext] || 'application/octet-stream';
};

module.exports = {
  syncDirectory,
  getAllPhysicalFiles,
  getAllDbRecords,
  guessMimeType,
};

