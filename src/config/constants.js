// 默认允许的文件扩展名（文档用途，实际白名单由 config.allowedExtensions 控制）
const DEFAULT_ALLOWED_EXTENSIONS = [
  '.zip', '.iso', '.pdf', '.txt', '.png', '.jpg', '.jpeg',
  '.gz', '.tar', '.7z', '.doc', '.docx', '.xlsx', '.md', '.jar',
];

// 禁止上传的扩展名（即使不在白名单中也要显式拒绝）
const BLOCKED_EXTENSIONS = [
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.sh', '.bash', '.bat', '.cmd', '.ps1',
  '.php', '.py', '.rb', '.pl',
  '.exe', '.dll', '.so', '.dylib',
  '.html', '.htm', '.svg',
];

// 文件大小限制
const MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB

// 批量操作限制
const MAX_BATCH_SIZE = 100;

// 分页默认值
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// SHA256 计算批次大小
const CHECKSUM_BATCH_SIZE = 10;

// 同步批次大小
const SYNC_BATCH_SIZE = 500;

module.exports = {
  DEFAULT_ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  CHECKSUM_BATCH_SIZE,
  SYNC_BATCH_SIZE,
};
