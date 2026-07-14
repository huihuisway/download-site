const { db } = require('../db');
const { config } = require('../config');
const { SYNC_BATCH_SIZE, CHECKSUM_BATCH_SIZE } = require('../config/constants');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const getAllPhysicalFiles = async () => {
  const files = [];

  const scanDir = async (dir, relativeBase = '') => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在或无权限
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await scanDir(fullPath, relativePath);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(fullPath);
        files.push({
          file_name: entry.name,
          file_path: relativePath.replace(/\\/g, '/'),
          category: relativeBase ? relativeBase.split(path.sep)[0].replace(/\\/g, '/') : 'root',
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
        updated_at = CURRENT_TIMESTAMP
    WHERE file_path = @file_path
  `);

  const deleteStmt = db.prepare('DELETE FROM download_logs WHERE file_path = ?');

  const syncTransaction = db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    const needsChecksum = [];

    // UPSERT: 处理物理文件
    for (let i = 0; i < physicalFiles.length; i++) {
      const file = physicalFiles[i];
      const existing = dbPathMap.get(file.file_path);

      if (!existing) {
        // 新文件 - 插入
        const mime = guessMimeType(file.file_name);
        upsertStmt.run({
          ...file,
          mime_type: mime,
        });
        inserted++;
        needsChecksum.push(file.file_path);
      } else if (existing.file_mtime !== file.file_mtime) {
        // 文件已修改 - 更新元信息，标记重算 sha256
        updateMtimeStmt.run({
          file_size: file.file_size,
          file_mtime: file.file_mtime,
          file_path: file.file_path,
        });
        updated++;
        needsChecksum.push(file.file_path);
      }

      // 分批提交
      if ((i + 1) % SYNC_BATCH_SIZE === 0) {
        // 事务内自动处理
      }
    }

    // DELETE: 清理已删除的文件
    for (const record of dbRecords) {
      if (!physicalPathSet.has(record.file_path)) {
        deleteStmt.run(record.file_path);
        deleted++;
      }
    }

    return { inserted, updated, deleted, needsChecksum };
  });

  const result = syncTransaction();

  // 异步计算 SHA256（测试模式下跳过）
  if (result.needsChecksum.length > 0 && process.env.NODE_ENV !== 'test') {
    scheduleChecksumComputation(result.needsChecksum);
  }

  return result;
};

const scheduleChecksumComputation = (filePaths) => {
  const { computeChecksumSync } = require('./checksum.service');

  const processBatch = (batch) => {
    const updateStmt = db.prepare('UPDATE download_logs SET sha256 = ?, updated_at = CURRENT_TIMESTAMP WHERE file_path = ?');

    const batchTransaction = db.transaction(() => {
      for (const filePath of batch) {
        try {
          const fullPath = require('path').join(config.downloadDir, filePath);
          const hash = computeChecksumSync(fullPath);
          updateStmt.run(hash, filePath);
        } catch (err) {
          console.error(`[sync] SHA256 计算失败: ${filePath}`, err.message);
        }
      }
    });

    batchTransaction();
  };

  // 分批处理
  for (let i = 0; i < filePaths.length; i += CHECKSUM_BATCH_SIZE) {
    const batch = filePaths.slice(i, i + CHECKSUM_BATCH_SIZE);
    setImmediate(() => processBatch(batch));
  }
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
  };
  return mimeMap[ext] || 'application/octet-stream';
};

module.exports = {
  syncDirectory,
  getAllPhysicalFiles,
  getAllDbRecords,
  guessMimeType,
};
