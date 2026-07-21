const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-sync.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-sync-test');

const clearModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)];
};

describe('sync service', () => {
  const testDir = process.env.DOWNLOAD_DIR;

  before(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}

    fs.mkdirSync(path.join(testDir, 'documents', 'guides', 'v1'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'software'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'empty', 'nested'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

    fs.writeFileSync(path.join(testDir, 'documents', 'readme.txt'), 'hello world');
    fs.writeFileSync(path.join(testDir, 'documents', 'guides', 'v1', 'manual.txt'), 'nested docs');
    fs.writeFileSync(path.join(testDir, 'software', 'app.zip'), 'fake zip content');
  });

  beforeEach(() => {
    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  });

  it('应该能初始化数据库', () => {
    const { db } = require('../src/db');
    assert.ok(db);
  });

  it('应该能扫描物理文件并返回完整父目录 category', async () => {
    const { getAllPhysicalFiles } = require('../src/services/sync.service');
    const files = await getAllPhysicalFiles();

    assert.ok(files.length >= 3);
    assert.ok(files.some((f) => f.file_name === 'readme.txt' && f.category === 'documents'));
    assert.ok(files.some((f) => f.file_name === 'manual.txt' && f.category === 'documents/guides/v1'));
    assert.ok(files.some((f) => f.file_name === 'app.zip' && f.category === 'software'));
  });

  it('应该能执行同步并写入完整父目录 category', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const { db } = require('../src/db');

    const result = await syncDirectory();
    assert.ok(result.inserted >= 3, `Expected >=3 inserted, got ${result.inserted}`);
    assert.strictEqual(result.deleted, 0);

    const nested = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('documents/guides/v1/manual.txt');
    assert.ok(nested);
    assert.strictEqual(nested.category, 'documents/guides/v1');
  });

  it('同步后数据库应有记录', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const { db } = require('../src/db');

    await syncDirectory();
    const count = db.prepare('SELECT COUNT(*) as count FROM download_logs').get().count;
    assert.ok(count >= 3);
  });

  it('应该检测到删除的文件并清理记录', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const { db } = require('../src/db');

    await syncDirectory();
    fs.unlinkSync(path.join(testDir, 'documents', 'readme.txt'));

    const result = await syncDirectory();
    assert.ok(result.deleted >= 1, `Expected >=1 deleted, got ${result.deleted}`);

    const remaining = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').all('readme.txt');
    assert.strictEqual(remaining.length, 0);
  });

  it('下载目录不可读时应该显式报错而不是返回 0', async () => {
    clearModule('../src/services/sync.service');
    const fsp = require('fs').promises;
    const originalReaddir = fsp.readdir;

    fsp.readdir = async (targetDir, options) => {
      if (path.resolve(targetDir) === path.resolve(testDir)) {
        const err = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return originalReaddir.call(fsp, targetDir, options);
    };

    try {
      const { getAllPhysicalFiles } = require('../src/services/sync.service');
      await assert.rejects(
        () => getAllPhysicalFiles(),
        /扫描目录失败: .*permission denied/
      );
    } finally {
      fsp.readdir = originalReaddir;
      clearModule('../src/services/sync.service');
    }
  });

  it('目录列表应包含没有文件的嵌套物理目录', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const fileService = require('../src/services/file.service');

    await syncDirectory();
    const categories = fileService.getCategories();

    assert.ok(categories.some((category) => category.category === 'documents/guides'));
    assert.ok(categories.some((category) => category.category === 'documents/guides/v1'));
    assert.ok(categories.some((category) => category.category === 'empty'));
    assert.ok(categories.some((category) => category.category === 'empty/nested'));
    assert.ok(categories.some((category) => category.category === 'empty/nested' && category.file_count === 0));
  });
});

