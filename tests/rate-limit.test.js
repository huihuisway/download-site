const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-rate-limit.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-rate-limit-test');
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.RATE_LIMIT_LOGIN_MAX = '2';

const request = (server, targetPath, options = {}) =>
  new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: targetPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

const postLogin = (server, password) => {
  const body = JSON.stringify({ username: 'testadmin', password });
  return request(server, '/auth/local-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
};

describe('rate limiting', () => {
  let server;

  before(async () => {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    if (server) server.close();
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
    try { fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true }); } catch {}
  });

  it('连续错误登录超过限制应返回 429', async () => {
    const first = await postLogin(server, 'wrong-1');
    const second = await postLogin(server, 'wrong-2');
    const third = await postLogin(server, 'wrong-3');

    assert.strictEqual(first.statusCode, 401);
    assert.strictEqual(second.statusCode, 401);
    assert.strictEqual(third.statusCode, 429);
    assert.ok(third.headers['ratelimit-limit'] || third.headers['ratelimit']);
  });

  it('未认证的 /api/v1 请求应返回 401(限流在认证之后)', async () => {
    const res = await request(server, '/api/v1/files');
    assert.strictEqual(res.statusCode, 401);
  });
});
