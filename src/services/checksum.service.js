const fs = require('fs');
const crypto = require('crypto');

/** 流式计算 SHA256，避免大文件一次性读入内存 */
const computeChecksum = async (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
};

module.exports = {
  computeChecksum,
};
