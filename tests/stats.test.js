const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-stats.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-stats-test');

describe('stats service', () => {
  const testDir = process.env.DOWNLOAD_DIR;

  before(() => {
    fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'docs', 'a.txt'), 'hello');

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
  });

  after(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  });

  describe('recordDownload', () => {
    it('应该原子递增下载计数', () => {
      const { db } = require('../src/db');
      const statsService = require('../src/services/stats.service');

      db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count) VALUES (?, ?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 5, 0);

      statsService.recordDownload(1);
      let record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(1);
      assert.strictEqual(record.download_count, 1);
      assert.ok(record.last_download_at);

      statsService.recordDownload(1);
      record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(1);
      assert.strictEqual(record.download_count, 2);
    });

    it('多次递增应保持正确', () => {
      const statsService = require('../src/services/stats.service');
      const { db } = require('../src/db');

      for (let i = 0; i < 10; i++) {
        statsService.recordDownload(1);
      }

      const record = db.prepare('SELECT * FROM download_logs WHERE id = ?').get(1);
      assert.strictEqual(record.download_count, 12); // 2 + 10
    });
  });

  describe('getDashboardStats', () => {
    it('应该返回正确的统计数据', () => {
      const { db } = require('../src/db');
      const statsService = require('../src/services/stats.service');

      // 添加更多文件
      db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count) VALUES (?, ?, ?, ?, ?)'
      ).run('b.zip', 'software/b.zip', 'software', 1024, 5);

      const stats = statsService.getDashboardStats();
      assert.strictEqual(stats.totalFiles, 2);
      assert.ok(stats.totalDownloads >= 12);
      assert.strictEqual(stats.totalSize, 1024 + 5); // file_size of a.txt (5 bytes) + b.zip (1024)
    });

    it('分类数应使用 COUNT(DISTINCT)', () => {
      const statsService = require('../src/services/stats.service');
      const stats = statsService.getDashboardStats();
      assert.strictEqual(stats.totalCategories, 2); // docs, software
    });
  });

  describe('getAllFiles', () => {
    it('应该支持分页', () => {
      const statsService = require('../src/services/stats.service');
      const result = statsService.getAllFiles({ page: 1, pageSize: 1 });
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.pagination.totalPages, 2);
    });

    it('应该支持分类过滤', () => {
      const statsService = require('../src/services/stats.service');
      const result = statsService.getAllFiles({ category: 'docs' });
      assert.ok(result.files.every((f) => f.category === 'docs'));
    });

    it('搜索应在分页之前生效(回归:此前只搜当前页)', () => {
      const statsService = require('../src/services/stats.service');
      // pageSize=1 时按 file_name 升序第一页是 a.txt;搜索 b.zip 必须跨页命中
      const result = statsService.getAllFiles({ page: 1, pageSize: 1, search: 'b.zip' });
      assert.strictEqual(result.files.length, 1);
      assert.strictEqual(result.files[0].file_name, 'b.zip');
      assert.strictEqual(result.pagination.total, 1);
    });

    it('搜索不区分大小写且空白搜索等于不过滤', () => {
      const statsService = require('../src/services/stats.service');
      const upper = statsService.getAllFiles({ search: 'B.ZIP' });
      assert.strictEqual(upper.pagination.total, 1);
      const blank = statsService.getAllFiles({ search: '   ' });
      assert.strictEqual(blank.pagination.total, 2);
    });
  });

  describe('getTopFiles', () => {
    it('单个 LIMIT 位置参数应正确生效(回归:此前恒返回空数组)', () => {
      const statsService = require('../src/services/stats.service');
      const top = statsService.getTopFiles(5);
      assert.ok(top.length > 0, 'getTopFiles 不应返回空数组');
      // 按 download_count 降序
      for (let i = 1; i < top.length; i++) {
        assert.ok(top[i - 1].download_count >= top[i].download_count);
      }
    });

    it('LIMIT 应截断结果数量', () => {
      const statsService = require('../src/services/stats.service');
      const top = statsService.getTopFiles(1);
      assert.strictEqual(top.length, 1);
    });
  });

  describe('getFileByPath', () => {
    it('应该按 file_path 精确查找文件', () => {
      const statsService = require('../src/services/stats.service');
      const file = statsService.getFileByPath('docs/a.txt');
      assert.ok(file);
      assert.strictEqual(file.file_name, 'a.txt');
      assert.strictEqual(file.category, 'docs');
    });

    it('查不到路径时应返回空值', () => {
      const statsService = require('../src/services/stats.service');
      assert.strictEqual(statsService.getFileByPath('docs/missing.txt'), undefined);
    });
  });

  describe('getCategoryStats', () => {
    it('应按分类聚合统计', () => {
      const statsService = require('../src/services/stats.service');
      const stats = statsService.getCategoryStats();
      assert.ok(stats.length >= 2);
      const docsStat = stats.find((s) => s.category === 'docs');
      assert.ok(docsStat);
      assert.strictEqual(docsStat.file_count, 1);
    });
  });
});
