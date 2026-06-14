const fs = require('fs');
const path = require('path');

const createFileStream = (filePath, res, mime) => {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    res.set({
      'Content-Type': mime || 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: '文件读取失败' });
      }
      reject(err);
    });

    stream.on('end', resolve);

    stream.pipe(res);
  });
};

module.exports = {
  createFileStream,
};
