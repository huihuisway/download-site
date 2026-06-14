const fs = require('fs');
const crypto = require('crypto');

const computeChecksumSync = (filePath) => {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
};

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
  computeChecksumSync,
};
