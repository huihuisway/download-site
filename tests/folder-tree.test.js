const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeFolderPath,
  getParentFolderPath,
  listFolderEntries,
} = require('../src/services/folder-tree.service');

describe('folder tree service', () => {
  const files = [
    { file_name: 'readme.pdf', file_path: 'docs/guides/v1/readme.pdf', category: 'docs/guides/v1' },
    { file_name: 'changelog.txt', file_path: 'docs/guides/v1/changelog.txt', category: 'docs/guides/v1' },
    { file_name: 'banner.png', file_path: 'assets/images/banner.png', category: 'assets/images' },
  ];
  const physicalFolders = ['docs', 'docs/guides', 'docs/guides/v1', 'docs/empty', 'assets', 'assets/images'];

  it('应将目录路径规范化为统一格式', () => {
    assert.strictEqual(normalizeFolderPath('docs/guides/'), 'docs/guides');
    assert.strictEqual(normalizeFolderPath('/docs//guides/v1'), 'docs/guides/v1');
    assert.strictEqual(normalizeFolderPath(''), 'root');
  });

  it('应拒绝含路径穿越段的目录路径', () => {
    assert.throws(() => normalizeFolderPath('../../etc'), /路径越界/);
    assert.throws(() => normalizeFolderPath('a/../b'), /路径越界/);
    assert.throws(() => normalizeFolderPath('..'), /路径越界/);
    assert.throws(() => normalizeFolderPath('.'), /路径越界/);
    assert.throws(() => normalizeFolderPath('..\\..\\x'), /路径越界/);
    // 名字里含点但非穿越段的目录仍合法
    assert.strictEqual(normalizeFolderPath('foo..bar/v1.2'), 'foo..bar/v1.2');
  });

  it('应从文件路径推导完整父目录', () => {
    assert.strictEqual(getParentFolderPath('docs/guides/v1/readme.pdf'), 'docs/guides/v1');
    assert.strictEqual(getParentFolderPath('readme.pdf'), 'root');
  });

  it('目录页只返回直接子目录和当前目录文件', () => {
    const result = listFolderEntries({ currentPath: 'docs', files, physicalFolders });
    assert.deepStrictEqual(result.directories.map((d) => d.path), ['docs/empty', 'docs/guides']);
    assert.deepStrictEqual(result.files.map((f) => f.file_path), []);
    assert.deepStrictEqual(result.ancestors, [
      { name: 'docs', path: 'docs' },
    ]);
    assert.strictEqual(result.isRoot, false);
    assert.strictEqual(result.parentHref, '/');
    assert.strictEqual(result.rootHref, '/');
  });

  it('根目录的 parentHref 应为 null', () => {
    const result = listFolderEntries({ currentPath: 'root', files, physicalFolders });
    assert.strictEqual(result.isRoot, true);
    assert.strictEqual(result.parentHref, null);
    assert.strictEqual(result.rootHref, '/');
    assert.deepStrictEqual(result.ancestors, []);
  });

  it('深层目录应有正确的祖先和父级 href', () => {
    const result = listFolderEntries({ currentPath: 'docs/guides/v1', files, physicalFolders });
    assert.deepStrictEqual(result.ancestors.map(a => a.path), ['docs', 'docs/guides', 'docs/guides/v1']);
    assert.strictEqual(result.parentHref, '/category/docs/guides');
    assert.strictEqual(result.isRoot, false);
  });

  it('treeRows 应正确表达多级目录结构', () => {
    const result = listFolderEntries({ currentPath: 'docs', files, physicalFolders });
    const paths = result.treeRows.map(r => r.path);
    assert.ok(paths.includes('docs/guides'));
    assert.ok(paths.includes('docs/empty'));
    // v1 should be a nested row under guides
    const v1Row = result.treeRows.find(r => r.path === 'docs/guides/v1');
    assert.ok(v1Row);
    assert.strictEqual(v1Row.depth, 1);
  });

  it('空目录页应被识别为可访问且为空', () => {
    const result = listFolderEntries({ currentPath: 'docs/empty', files, physicalFolders });
    assert.strictEqual(result.isEmpty, true);
    assert.deepStrictEqual(result.directories, []);
    assert.deepStrictEqual(result.files, []);
  });
});