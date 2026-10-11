const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * 为单个测试文件准备独立的临时数据库、下载和会话目录，并在 require src 之前设置环境变量。
 * 必须在任何 require('../src/...') 之前调用——config 模块在加载时就读取这些变量。
 *
 * 用系统临时目录而非仓库内路径，避免测试产物污染工作区（崩溃退出时也不会残留）。
 */
const setupTmpEnv = (name) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dlsite-${name}-`));
  const dbPath = path.join(root, 'test.db');
  const downloadDir = path.join(root, 'downloads');
  const sessionDir = path.join(root, 'sessions');

  process.env.DB_PATH = dbPath;
  process.env.DOWNLOAD_DIR = downloadDir;
  process.env.SESSION_DIR = sessionDir;
  fs.mkdirSync(downloadDir, { recursive: true });

  const cleanup = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // 目录被占用时忽略，临时目录由系统回收
    }
  };

  return { root, dbPath, downloadDir, sessionDir, cleanup };
};

module.exports = { setupTmpEnv };
