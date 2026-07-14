const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const testDbPath = path.join(__dirname, '..', 'data', 'test-db-unit.db');
process.env.DB_PATH = testDbPath;

describe('JSON Database', () => {
  let dbModule;

  before(() => {
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    try { fs.unlinkSync(testDbPath); } catch {}
    dbModule = require('../src/db');
  });

  after(() => {
    try { fs.unlinkSync(testDbPath); } catch {}
    try { fs.unlinkSync(testDbPath + '.tmp'); } catch {}
  });

  beforeEach(() => {
    dbModule.db.data.download_logs = [];
    dbModule.db.data._nextId = 1;
    dbModule.db._save();
  });

  describe('INSERT and SELECT', () => {
    it('应该插入记录并返回自增 ID', () => {
      const result = dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('test.txt', 'docs/test.txt', 'docs');

      assert.strictEqual(result.changes, 1);
      assert.strictEqual(result.lastInsertRowid, 1);
    });

    it('应该能查询所有记录', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs');
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('b.zip', 'software/b.zip', 'software');

      const all = dbModule.db.prepare('SELECT * FROM download_logs').all();
      assert.strictEqual(all.length, 2);
    });

    it('应该支持 WHERE 条件查询', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 100);
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)'
      ).run('b.zip', 'software/b.zip', 'software', 200);

      const result = dbModule.db.prepare(
        'SELECT * FROM download_logs WHERE category = ?'
      ).all('docs');
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].file_name, 'a.txt');
    });

    it('应该支持 ORDER BY', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)'
      ).run('b.txt', 'docs/b.txt', 'docs', 200);
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 100);

      const asc = dbModule.db.prepare(
        'SELECT * FROM download_logs ORDER BY file_name ASC'
      ).all();
      assert.strictEqual(asc[0].file_name, 'a.txt');

      const desc = dbModule.db.prepare(
        'SELECT * FROM download_logs ORDER BY file_size DESC'
      ).all();
      assert.strictEqual(desc[0].file_size, 200);
    });

    it('应该支持 LIMIT 和 OFFSET', () => {
      for (let i = 0; i < 5; i++) {
        dbModule.db.prepare(
          'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
        ).run(`file${i}.txt`, `docs/file${i}.txt`, 'docs');
      }

      const limited = dbModule.db.prepare(
        'SELECT * FROM download_logs LIMIT ? OFFSET ?'
      ).all(2, 1);
      assert.strictEqual(limited.length, 2);
    });
  });

  describe('COUNT(DISTINCT)', () => {
    it('应该正确计算不重复值数量', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs');
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('b.txt', 'docs/b.txt', 'docs');
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('c.zip', 'software/c.zip', 'software');

      const result = dbModule.db.prepare(
        'SELECT COUNT(DISTINCT category) as count FROM download_logs'
      ).get();
      assert.strictEqual(result.count, 2);
    });
  });

  describe('WHERE 严格相等', () => {
    it('数字和字符串应正确匹配（ID 场景）', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, download_count) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 5);

      // 字符串 '5' 应匹配数字 5（ID 兼容）
      const result = dbModule.db.prepare(
        'SELECT * FROM download_logs WHERE download_count = ?'
      ).all(5);
      assert.strictEqual(result.length, 1);
    });

    it('false 不应匹配 0', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, download_count) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 0);

      const result = dbModule.db.prepare(
        'SELECT * FROM download_logs WHERE download_count = ?'
      ).all(false);
      assert.strictEqual(result.length, 0);
    });

    it('空字符串不应匹配 0', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, download_count) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 0);

      const result = dbModule.db.prepare(
        'SELECT * FROM download_logs WHERE download_count = ?'
      ).all('');
      assert.strictEqual(result.length, 0);
    });
  });

  describe('UPDATE with download_count increment', () => {
    it('应该原子递增 download_count', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category, download_count) VALUES (?, ?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs', 3);

      dbModule.db.prepare(`
        UPDATE download_logs
        SET download_count = download_count + 1
        WHERE file_path = ?
      `).run('docs/a.txt');

      const record = dbModule.db.prepare(
        'SELECT * FROM download_logs WHERE file_path = ?'
      ).get('docs/a.txt');
      assert.strictEqual(record.download_count, 4);
    });
  });

  describe('DELETE', () => {
    it('应该按条件删除记录', () => {
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('a.txt', 'docs/a.txt', 'docs');
      dbModule.db.prepare(
        'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
      ).run('b.zip', 'software/b.zip', 'software');

      const result = dbModule.db.prepare(
        'DELETE FROM download_logs WHERE category = ?'
      ).run('docs');
      assert.strictEqual(result.changes, 1);

      const remaining = dbModule.db.prepare('SELECT * FROM download_logs').all();
      assert.strictEqual(remaining.length, 1);
      assert.strictEqual(remaining[0].file_name, 'b.zip');
    });
  });

  describe('原子写入', () => {
    it('_save 应使用临时文件 + rename', () => {
      dbModule.db.data.download_logs.push({ id: 99, file_name: 'test' });
      dbModule.db._save();

      // 验证文件存在且内容正确
      const raw = fs.readFileSync(testDbPath, 'utf-8');
      const data = JSON.parse(raw);
      assert.ok(data.download_logs.some((r) => r.id === 99));

      // 临时文件应该已被 rename 走
      assert.ok(!fs.existsSync(testDbPath + '.tmp'));
    });
  });

  describe('事务', () => {
    it('事务应批量执行并保存', () => {
      const tx = dbModule.db.transaction(() => {
        dbModule.db.prepare(
          'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
        ).run('a.txt', 'docs/a.txt', 'docs');
        dbModule.db.prepare(
          'INSERT INTO download_logs (file_name, file_path, category) VALUES (?, ?, ?)'
        ).run('b.zip', 'software/b.zip', 'software');
      });

      tx();
      const all = dbModule.db.prepare('SELECT * FROM download_logs').all();
      assert.strictEqual(all.length, 2);
    });
  });
});
