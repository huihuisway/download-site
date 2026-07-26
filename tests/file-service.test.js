const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('file-service');

describe('file service - nested folder operations', () => {
  const testDir = process.env.DOWNLOAD_DIR;

  before(() => {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
  });

  after(() => {
    tmpEnv.cleanup();
  });

  describe('createFolder', () => {
    it('应能创建多级目录', () => {
      const fileService = require('../src/services/file.service');
      const result = fileService.createFolder('docs/guides/v1');
      assert.strictEqual(result.folder, 'docs/guides/v1');
      assert.ok(fs.existsSync(path.join(testDir, 'docs', 'guides', 'v1')));
    });

    it('不能创建根目录', () => {
      const fileService = require('../src/services/file.service');
      assert.throws(() => fileService.createFolder(''), /不能创建根目录/);
      assert.throws(() => fileService.createFolder('/'), /不能创建根目录/);
    });

    it('应规范化路径中的反斜杠和多余斜杠', () => {
      const fileService = require('../src/services/file.service');
      const result = fileService.createFolder('assets\\\\images//banners/');
      assert.strictEqual(result.folder, 'assets/images/banners');
    });
  });

  describe('renameFolder', () => {
    it('重命名目录时应更新整个子树文件路径', () => {
      const fileService = require('../src/services/file.service');
      const { db } = require('../src/db');

      // Create a DB record under docs/guides/v1
      db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)')
        .run('readme.pdf', 'docs/guides/v1/readme.pdf', 'docs/guides/v1', 1024);

      const result = fileService.renameFolder('docs/guides', 'manuals');
      assert.strictEqual(result.old_path, 'docs/guides');
      assert.strictEqual(result.new_path, 'docs/manuals');
      assert.strictEqual(result.moved_files, 1);

      // Physical folder should be renamed
      assert.ok(!fs.existsSync(path.join(testDir, 'docs', 'guides')));
      assert.ok(fs.existsSync(path.join(testDir, 'docs', 'manuals', 'v1')));

      // DB record should be updated
      const updatedFile = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').get('readme.pdf');
      assert.strictEqual(updatedFile.file_path, 'docs/manuals/v1/readme.pdf');
      assert.strictEqual(updatedFile.category, 'docs/manuals/v1');
    });

    it('不能重命名根目录', () => {
      const fileService = require('../src/services/file.service');
      assert.throws(() => fileService.renameFolder('root', 'newname'), /不能重命名根目录/);
    });
  });

  describe('deleteFolder', () => {
    it('空目录可以直接删除', () => {
      const fileService = require('../src/services/file.service');
      fileService.createFolder('empty-folder/sub');
      const result = fileService.deleteFolder('empty-folder/sub');
      assert.ok(result.deleted_folders.includes('empty-folder/sub'));
      assert.ok(!fs.existsSync(path.join(testDir, 'empty-folder', 'sub')));
    });

    it('有文件的目录非递归删除应报错', () => {
      const fileService = require('../src/services/file.service');
      const { db } = require('../src/db');

      fileService.createFolder('with-files');
      db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)')
        .run('test.txt', 'with-files/test.txt', 'with-files', 100);

      assert.throws(
        () => fileService.deleteFolder('with-files'),
        /个文件/
      );
    });

    it('递归删除应同时清理文件和目录', () => {
      const fileService = require('../src/services/file.service');
      const { db } = require('../src/db');

      fileService.createFolder('recursive-test/sub');

      // Create physical file
      const filePath = path.join(testDir, 'recursive-test', 'sub', 'data.txt');
      fs.writeFileSync(filePath, 'test data');

      db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)')
        .run('data.txt', 'recursive-test/sub/data.txt', 'recursive-test/sub', 9);

      const result = fileService.deleteFolder('recursive-test', { recursive: true });
      assert.ok(result.deleted_folders.includes('recursive-test'));
      assert.ok(result.deleted_files.includes('recursive-test/sub/data.txt'));
      assert.ok(!fs.existsSync(path.join(testDir, 'recursive-test')));

      // DB record should be deleted
      const remaining = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').get('data.txt');
      assert.strictEqual(remaining, undefined);
    });

    it('不能删除根目录', () => {
      const fileService = require('../src/services/file.service');
      assert.throws(() => fileService.deleteFolder('root'), /不能删除根目录/);
    });
  });

  describe('moveFile with full folder path', () => {
    it('应支持将文件移动到多级目录', () => {
      const fileService = require('../src/services/file.service');
      const { db } = require('../src/db');

      // Create physical file in root
      fileService.createFolder('source');
      const srcPath = path.join(testDir, 'source', 'moveme.txt');
      fs.writeFileSync(srcPath, 'move me');

      db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)')
        .run('moveme.txt', 'source/moveme.txt', 'source', 7);

      const record = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').get('moveme.txt');

      fileService.createFolder('dest/nested/deep');
      const result = fileService.moveFile(record.id, 'dest/nested/deep');

      assert.strictEqual(result.new_path, 'dest/nested/deep/moveme.txt');
      assert.strictEqual(result.new_category, 'dest/nested/deep');

      // Physical file should be moved
      assert.ok(!fs.existsSync(srcPath));
      assert.ok(fs.existsSync(path.join(testDir, 'dest', 'nested', 'deep', 'moveme.txt')));

      // DB should be updated
      const updated = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').get('moveme.txt');
      assert.strictEqual(updated.file_path, 'dest/nested/deep/moveme.txt');
      assert.strictEqual(updated.category, 'dest/nested/deep');
    });

    it('应支持移动到根目录', () => {
      const fileService = require('../src/services/file.service');
      const folderTreeService = require('../src/services/folder-tree.service');
      const category = folderTreeService.getParentFolderPath('moveme.txt');
      assert.strictEqual(category, 'root');
    });

    it('移动到穿越路径应报错且不在沙箱外创建目录', () => {
      const fileService = require('../src/services/file.service');
      const { db } = require('../src/db');

      fileService.createFolder('escape-src');
      fs.writeFileSync(path.join(testDir, 'escape-src', 'victim.txt'), 'stay');
      db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size) VALUES (?, ?, ?, ?)')
        .run('victim.txt', 'escape-src/victim.txt', 'escape-src', 4);
      const record = db.prepare('SELECT * FROM download_logs WHERE file_name = ?').get('victim.txt');

      assert.throws(() => fileService.moveFile(record.id, '../escape'), /路径越界/);
      // 回归:此前 mkdirSync 在沙箱校验之前执行,会在沙箱外创建目录树
      assert.ok(!fs.existsSync(path.join(testDir, '..', 'escape')));
      // 文件保持原位
      assert.ok(fs.existsSync(path.join(testDir, 'escape-src', 'victim.txt')));
    });
  });

  describe('category from folder path', () => {
    it('应以完整父目录路径保存 category', () => {
      const folderTreeService = require('../src/services/folder-tree.service');
      const category = folderTreeService.getParentFolderPath('docs/guides/v1/readme.pdf');
      assert.strictEqual(category, 'docs/guides/v1');
    });

    it('根目录文件的 category 应为 root', () => {
      const folderTreeService = require('../src/services/folder-tree.service');
      const category = folderTreeService.getParentFolderPath('readme.pdf');
      assert.strictEqual(category, 'root');
    });
  });
});
