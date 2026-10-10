const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  presentAsset,
  isPlayerDownload,
  mergeFeaturedAssets,
  findReleaseForQuery,
  versionAnchorFor,
} = require('../src/services/mindustry-presentation.service');
const { compareVersionTags } = require('../src/services/mindustry-index.service');

describe('Mindustry presentation helpers', () => {
  it('presents Android, Windows, Linux and JAR downloads with readable labels', () => {
    assert.strictEqual(presentAsset({ file_name: 'release.apk', platform: 'android', size: 82 }).displayName, 'Android APK');
    assert.strictEqual(presentAsset({ file_name: 'mindustry-windows-64-bit.zip', platform: 'windows' }).displayName, 'Windows 64 位');
    assert.strictEqual(presentAsset({ file_name: 'mindustry-linux-64-bit.zip', platform: 'linux' }).displayName, 'Linux 64 位');
    assert.strictEqual(presentAsset({ file_name: 'Mindustry.jar', platform: 'desktop' }).displayName, '通用 JAR');
  });

  it('keeps unknown assets visible and tolerates absent size, checksum and URL', () => {
    const asset = presentAsset({ file_name: 'readme.data' });
    assert.strictEqual(asset.platform, 'advanced');
    assert.strictEqual(asset.displayName, '其他文件');
    assert.strictEqual(asset.fileSize, null);
    assert.strictEqual(asset.checksum, null);
    assert.strictEqual(asset.downloadUrl, '');
    assert.strictEqual(isPlayerDownload(asset), false);
  });

  it('adds real featured downloads to the matching release without inventing URLs', () => {
    const release = { tag: 'v160.10', channel: 'stable', assets: [{ file_name: 'Mindustry.jar', platform: 'desktop', download_url: '/d/jar' }] };
    const featured = {
      game_version: 'v8',
      build: '160.10',
      assets: [{ file_name: 'mindustry-windows-64-bit.zip', platform: 'windows', download_url: '/d/windows' }],
    };
    const merged = mergeFeaturedAssets(release, featured);
    assert.deepStrictEqual(merged.map((asset) => asset.downloadUrl), ['/d/jar', '/d/windows']);
    assert.strictEqual(mergeFeaturedAssets({ ...release, tag: 'v160.9' }, featured).length, 1);
  });

  it('sorts numeric version segments semantically', () => {
    assert.ok(compareVersionTags('v160.10', 'v160.9') < 0);
    assert.ok(compareVersionTags('v160.5', 'v160') < 0);
    assert.ok(compareVersionTags('v9', 'v10') > 0);
    assert.ok(compareVersionTags('v160.10-BE', 'v160.10') > 0);
    assert.strictEqual(compareVersionTags('v160.10', 'v160.10'), 0);
  });
});

describe('版本直达链接的解析', () => {
  const releases = [
    { tag: 'v160.7', build_name: 'v8 Build 160.7', channel: 'stable' },
    { tag: 'v157.4', build_name: 'v8 Build 157.4', channel: 'stable' },
    { tag: 'v157', build_name: 'v8 Build 157 - Beta', channel: 'prerelease' },
    { tag: 'v156.2', build_name: 'v8 Build 156.2 - Beta', channel: 'prerelease' },
  ];

  it('v160.4 与 160.4 等价，带不带前缀都能定位', () => {
    assert.strictEqual(findReleaseForQuery(releases, 'v160.7').tag, 'v160.7');
    assert.strictEqual(findReleaseForQuery(releases, '160.7').tag, 'v160.7');
    assert.strictEqual(findReleaseForQuery(releases, '  V160.7  ').tag, 'v160.7');
  });

  it('build_name 与 #version-* 写法都能匹配', () => {
    assert.strictEqual(findReleaseForQuery(releases, 'v8 Build 157.4').tag, 'v157.4');
    assert.strictEqual(findReleaseForQuery(releases, '#version-v157.4').tag, 'v157.4');
  });

  it('完全相等优先于前缀：v157 命中 tag 本身，v157.4 命中 stable', () => {
    assert.strictEqual(findReleaseForQuery(releases, '157').tag, 'v157');
    assert.strictEqual(findReleaseForQuery(releases, '157.4').tag, 'v157.4');
    // 只剩前缀匹配时优先挑正式版
    assert.strictEqual(findReleaseForQuery(releases, '15').tag, 'v157.4');
  });

  it('匹配不到时返回 null，交给页面提示「未找到」', () => {
    assert.strictEqual(findReleaseForQuery(releases, 'v999'), null);
    assert.strictEqual(findReleaseForQuery(releases, ''), null);
    assert.strictEqual(findReleaseForQuery(releases, 'x'.repeat(200)), null);
    assert.strictEqual(findReleaseForQuery([], '160.7'), null);
    assert.strictEqual(findReleaseForQuery(null, '160.7'), null);
  });

  it('锚点 id 稳定且同 tag 并存时不会互相覆盖', () => {
    const taken = new Set();
    const stable = versionAnchorFor({ tag: 'v157', channel: 'stable' }, taken);
    taken.add(stable);
    const beta = versionAnchorFor({ tag: 'v157', channel: 'prerelease' }, taken);
    taken.add(beta);
    assert.strictEqual(stable, 'version-v157');
    assert.strictEqual(beta, 'version-v157-beta');
    assert.strictEqual(versionAnchorFor({ build_name: 'v8 Build 160.7' }, new Set()), 'version-v8-build-160.7');
  });
});
