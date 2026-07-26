const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('error-handler');

const createRes = (acceptsResult) => ({
  statusCode: 200,
  body: null,
  rendered: null,
  headersSent: false,
  sentText: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  render(view, data) { this.rendered = { view, data }; return this; },
  type() { return this; },
  send(text) { this.sentText = text; return this; },
});

const createReq = (reqPath, acceptsResult) => ({
  method: 'GET',
  path: reqPath,
  accepts: () => acceptsResult,
});

describe('errorHandler', () => {
  before(() => {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
  });

  after(() => {
    tmpEnv.cleanup();
  });

  it('API 请求应返回 JSON 且不含 stack', () => {
    const { errorHandler } = require('../src/middleware/errorHandler');
    const req = createReq('/api/admin/files', 'json');
    const res = createRes();
    errorHandler(new Error('boom'), req, res, () => {});

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body);
    assert.strictEqual(res.body.stack, undefined);
    assert.strictEqual(res.rendered, null);
  });

  it('浏览器请求应渲染主题化错误页', () => {
    const { errorHandler } = require('../src/middleware/errorHandler');
    const req = createReq('/docs/a.txt', 'html');
    const res = createRes();
    errorHandler(new Error('boom'), req, res, () => {});

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.rendered, '应调用 render');
    assert.match(res.rendered.view, /^themes\/.+\/error$/);
    assert.ok(res.rendered.data.message);
    assert.ok(res.rendered.data.siteInfo);
    assert.strictEqual(res.rendered.data.errorType, 'generic');
  });

  it('路径越界错误应映射为 403', () => {
    const { errorHandler } = require('../src/middleware/errorHandler');
    const req = createReq('/api/admin/files/1/move', 'json');
    const res = createRes();
    errorHandler(new Error('路径越界: 非法目录路径'), req, res, () => {});

    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.error, /路径越界/);
  });

  it('上传体积超限应映射为 400', () => {
    const { errorHandler } = require('../src/middleware/errorHandler');
    const req = createReq('/api/admin/files/upload', 'json');
    const res = createRes();
    const err = new Error('File too large');
    err.code = 'LIMIT_FILE_SIZE';
    errorHandler(err, req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error, /文件大小/);
  });

  it('响应头已发出时不应再改写响应', () => {
    const { errorHandler } = require('../src/middleware/errorHandler');
    const req = createReq('/d/docs/a.txt', 'html');
    const res = createRes();
    res.headersSent = true;
    errorHandler(new Error('stream broke'), req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, null);
    assert.strictEqual(res.rendered, null);
  });
});
