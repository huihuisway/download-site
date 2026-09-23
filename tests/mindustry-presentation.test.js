const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { presentAsset, isPlayerDownload, mergeFeaturedAssets } = require('../src/services/mindustry-presentation.service');
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
