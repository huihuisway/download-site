const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-sync.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-sync-test');

describe('sync service', () => {
  const testDir = process.env.DOWNLOAD_DIR;

  before(() => {
    // 清理旧数据
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}

    fs.mkdirSync(path.join(testDir, 'documents'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'software'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });

    // 创建测试文件
    fs.writeFileSync(path.join(testDir, 'documents', 'readme.txt'), 'hello world');
    fs.writeFileSync(path.join(testDir, 'software', 'app.zip'), 'fake zip content');
  });

  after(() => {
    // 不等待异步操作，直接清理
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  });

  it('应该能初始化数据库', () => {
    const { db } = require('../src/db');
    assert.ok(db);
    // 清空现有记录以确保干净的测试环境
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
  });

  it('应该能扫描物理文件', async () => {
    const { getAllPhysicalFiles } = require('../src/services/sync.service');
    const files = await getAllPhysicalFiles();
    assert.ok(files.length >= 2);
    assert.ok(files.some((f) => f.file_name === 'readme.txt'));
    assert.ok(files.some((f) => f.file_name === 'app.zip'));
  });

  it('应该能执行同步', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const result = await syncDirectory();
    assert.ok(result.inserted >= 2, `Expected >=2 inserted, got ${result.inserted}`);
    assert.strictEqual(result.deleted, 0);
  });

  it('同步后数据库应有记录', () => {
    const { db } = require('../src/db');
    const count = db.prepare('SELECT COUNT(*) as count FROM download_logs').get().count;
    assert.ok(count >= 2);
  });

  it('应该检测到删除的文件并清理记录', async () => {
    const { syncDirectory } = require('../src/services/sync.service');
    const { db } = require('../src/db');

    // 删除一个物理文件
    fs.unlinkSync(path.join(testDir, 'documents', 'readme.txt'));

    const result = await syncDirectory();
    assert.ok(result.deleted >= 1, `Expected >=1 deleted, got ${result.deleted}`);

    // 验证 DB 记录已被清理
    const remaining = db.prepare("SELECT * FROM download_logs WHERE file_name = ?").all('readme.txt');
    assert.strictEqual(remaining.length, 0);
  });
});
