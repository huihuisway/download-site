const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('csp');

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
    req.end();
  });

describe('Content-Security-Policy', () => {
  let server;

  before(async () => {
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'a.txt'), 'hello csp');

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, mime_type) VALUES (?, ?, ?, ?, ?)'
    ).run('a.txt', 'docs/a.txt', 'docs', 9, 'text/plain');

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    tmpEnv.cleanup();
    if (server) server.close();
  });

  it('响应应带 CSP 头且 script-src 使用 nonce', async () => {
    const res = await request(server, '/');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp, '应返回 Content-Security-Policy 头');
    assert.match(csp, /script-src [^;]*'self'/);
    assert.match(csp, /script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
    assert.match(csp, /object-src 'none'/);
  });

  it('页面内联脚本的 nonce 应与响应头一致', async () => {
    const res = await request(server, '/');
    const csp = res.headers['content-security-policy'];
    const headerNonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)[1];

    // 模板中所有内联 <script> 都必须带上同一个 nonce，否则会被浏览器拦截
    const inlineScripts = res.body.match(/<script(?![^>]*\ssrc=)[^>]*>/g) || [];
    assert.ok(inlineScripts.length > 0, '页面应存在内联脚本');
    for (const tag of inlineScripts) {
      assert.ok(tag.includes(`nonce="${headerNonce}"`), `内联脚本缺少正确 nonce: ${tag}`);
    }
  });

  it('每次请求的 nonce 应不同', async () => {
    const first = await request(server, '/');
    const second = await request(server, '/');
    const nonceOf = (r) => r.headers['content-security-policy'].match(/'nonce-([A-Za-z0-9+/=]+)'/)[1];
    assert.notStrictEqual(nonceOf(first), nonceOf(second));
  });

  it('页面不应再使用内联事件属性(CSP 无法用 nonce 放行)', async () => {
    const pages = ['/', '/category/docs', '/docs/a.txt'];
    for (const p of pages) {
      const res = await request(server, p);
      assert.doesNotMatch(res.body, /\son[a-z]+\s*=\s*"/, `${p} 不应含内联事件属性`);
    }
  });

  it('主题切换按钮应保留可点击标记', async () => {
    const res = await request(server, '/');
    assert.match(res.body, /class="theme-toggle"/);
    assert.match(res.body, /addEventListener\('click', toggleTheme\)/);
  });
});
