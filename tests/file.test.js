const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-stats.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-test');

const { sanitizeFilename, isAllowedExtension, ensureInSandbox, getCategoryFromPath } = require('../src/utils/filename');

describe('filename utils', () => {
  before(() => {
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
  });

  after(() => {
    fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true });
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  });

  describe('sanitizeFilename', () => {
    it('应该保留安全文件名', () => {
      assert.strictEqual(sanitizeFilename('hello.txt'), 'hello.txt');
      assert.strictEqual(sanitizeFilename('my-file_v2.zip'), 'my-file_v2.zip');
    });

    it('应该清洗危险字符', () => {
      const result = sanitizeFilename('../../../etc/passwd');
      // sanitize-filename 会将路径分隔符替换，最终不应包含原始路径遍历
      assert.ok(!result.includes('/') && !result.includes('\\'));
    });

    it('应该拒绝空文件名', () => {
      assert.throws(() => sanitizeFilename(''), /无效的文件名/);
    });
  });

  describe('isAllowedExtension', () => {
    it('应该允许白名单扩展名', () => {
      assert.strictEqual(isAllowedExtension('file.zip'), true);
      assert.strictEqual(isAllowedExtension('file.pdf'), true);
      assert.strictEqual(isAllowedExtension('file.txt'), true);
    });

    it('应该拒绝非白名单扩展名', () => {
      assert.strictEqual(isAllowedExtension('file.exe'), false);
      assert.strictEqual(isAllowedExtension('file.js'), false);
      assert.strictEqual(isAllowedExtension('file.sh'), false);
    });

    it('应该拒绝无扩展名文件', () => {
      assert.strictEqual(isAllowedExtension('noext'), false);
    });
  });

  describe('ensureInSandbox', () => {
    it('应该允许沙箱内的路径', () => {
      const safePath = path.join(process.env.DOWNLOAD_DIR, 'test.txt');
      assert.doesNotThrow(() => ensureInSandbox(safePath));
    });

    it('应该拒绝沙箱外的路径', () => {
      const unsafePath = path.join(process.env.DOWNLOAD_DIR, '..', '..', 'etc', 'passwd');
      assert.throws(() => ensureInSandbox(unsafePath), /路径越界/);
    });
  });

  describe('getCategoryFromPath', () => {
    it('应该从路径中提取分类', () => {
      assert.strictEqual(getCategoryFromPath('software/app.zip'), 'software');
      assert.strictEqual(getCategoryFromPath('docs/readme.txt'), 'docs');
    });

    it('应该处理根目录文件', () => {
      assert.strictEqual(getCategoryFromPath('file.txt'), 'root');
    });
  });
});
