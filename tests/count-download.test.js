const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('count-download');

const request = (server, targetPath, options = {}) => new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.request({
    hostname: '127.0.0.1',
    port: address.port,
    path: targetPath,
    method: options.method || 'GET',
    headers: options.headers || {},
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });

  req.on('error', reject);
  if (options.body) req.write(options.body);
  req.end();
});

describe('POST /count-download', () => {
  let server;

  before(async () => {
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'test.txt'), 'test');

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('test.txt', 'test.txt', '', 4, 0, 'count test', 'text/plain');

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    tmpEnv.cleanup();
    if (server) {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('有效 fileId 应返回 success 并递增计数', async () => {
    const { db } = require('../src/db');
    // 取原始值（非引用），避免 DB 返回对象引用导致递增后 before 值也被改变
    const beforeCount = Number(
      db.prepare('SELECT download_count FROM download_logs WHERE file_path = ?').get('test.txt').download_count
    );

    const record = db.prepare('SELECT id FROM download_logs WHERE file_path = ?').get('test.txt');
    const response = await request(server, '/count-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: record.id }),
    });

    assert.strictEqual(response.statusCode, 200);
    const json = JSON.parse(response.body);
    assert.strictEqual(json.success, true);

    const afterCount = Number(
      db.prepare('SELECT download_count FROM download_logs WHERE file_path = ?').get('test.txt').download_count
    );
    assert.strictEqual(afterCount, beforeCount + 1);
  });

  it('缺少 fileId 应返回 400', async () => {
    const response = await request(server, '/count-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.strictEqual(response.statusCode, 400);
    const json = JSON.parse(response.body);
    assert.ok(json.error);
  });

  it('fileId 为非法类型应返回 400', async () => {
    const response = await request(server, '/count-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: true }),
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it('不存在的 fileId 应返回 200 但不报错（no-op）', async () => {
    const response = await request(server, '/count-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: '999999' }),
    });

    assert.strictEqual(response.statusCode, 200);
    const json = JSON.parse(response.body);
    assert.strictEqual(json.success, true);
  });

  it('文件详情页应包含下载追踪标记并加载外置计数脚本', async () => {
    const response = await request(server, '/test.txt');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /data-track="download"/);
    assert.match(response.body, /data-download-tracking/);
    assert.match(response.body, /\/js\/file-actions\.js/);
  });
});
