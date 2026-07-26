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

// SHA256 计算批次大小
const CHECKSUM_BATCH_SIZE = 10;

module.exports = {
  BLOCKED_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_BATCH_SIZE,
  CHECKSUM_BATCH_SIZE,
};
