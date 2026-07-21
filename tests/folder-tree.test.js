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

  it('应从文件路径推导完整父目录', () => {
    assert.strictEqual(getParentFolderPath('docs/guides/v1/readme.pdf'), 'docs/guides/v1');
    assert.strictEqual(getParentFolderPath('readme.pdf'), 'root');
  });

  it('目录页只返回直接子目录和当前目录文件', () => {
    const result = listFolderEntries({ currentPath: 'docs', files, physicalFolders });
    assert.deepStrictEqual(result.directories.map((d) => d.path), ['docs/empty', 'docs/guides']);
    assert.deepStrictEqual(result.files.map((f) => f.file_path), []);
    assert.deepStrictEqual(result.breadcrumbs, [
      { name: '首页', path: 'root' },
      { name: 'docs', path: 'docs' },
    ]);
  });

  it('空目录页应被识别为可访问且为空', () => {
    const result = listFolderEntries({ currentPath: 'docs/empty', files, physicalFolders });
    assert.strictEqual(result.isEmpty, true);
    assert.deepStrictEqual(result.directories, []);
    assert.deepStrictEqual(result.files, []);
  });
});