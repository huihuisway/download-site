const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const https = require('node:https');

const { classifyAsset, releaseChannel, metadataForAsset } = require('../src/services/mindustry-assets.service');
const { getLatestRelease } = require('../src/services/github-release.service');

describe('Mindustry release assets', () => {
  it('按平台和用途分类 Release 资产', () => {
    assert.deepStrictEqual(classifyAsset('Mindustry.jar'), { platform: 'desktop', asset_type: 'desktop' });
    assert.deepStrictEqual(classifyAsset('Mindustry-server.jar'), { platform: 'server', asset_type: 'server' });
    assert.deepStrictEqual(classifyAsset('Mindustry-MDT-Android-v160.4.apk'), { platform: 'android', asset_type: 'installer' });
    assert.deepStrictEqual(classifyAsset('dependencies.jar'), { platform: 'advanced', asset_type: 'build-dependency' });
  });

  it('将 MDT APK 映射到上游游戏版本并保留社区来源', () => {
    const metadata = metadataForAsset(
      { config: { game_id: 'mindustry', game_name: 'Mindustry' } },
      { id: 4, tag_name: 'mdt-mindustry-android-v160.4', name: 'v160.4 Community Android', prerelease: false, published_at: '2026-09-20T00:00:00Z' },
      { name: 'Mindustry-MDT-Android-v160.4.apk' },
      'mdtbbs/download-site',
    );

    assert.strictEqual(metadata.version_tag, 'v160.4');
    assert.strictEqual(metadata.release_tag, 'mdt-mindustry-android-v160.4');
    assert.strictEqual(metadata.build_name, 'v160.4 Community Android');
    assert.strictEqual(metadata.source_repository, 'mdtbbs/download-site');
    assert.strictEqual(metadata.release_channel, 'stable');
    assert.strictEqual(releaseChannel({ tag_name: 'v160.5-BE', prerelease: true }), 'prerelease');
  });

  it('将 Classic 资产识别为实际归档仓库的版本', () => {
    const metadata = metadataForAsset(
      null,
      { id: 7, tag_name: 'v6', prerelease: false },
      { name: 'Mindustry-Classic-Desktop.jar' },
      'Anuken/Mindustry-Classic',
    );
    assert.strictEqual(metadata.game_id, 'mindustry-classic');
    assert.strictEqual(metadata.source_repository, 'Anuken/Mindustry-Classic');
  });

  it('可以独立选择最新正式版和最新预发布版', async () => {
    const releases = [
      { id: 1, tag_name: 'v160.4', prerelease: false, draft: false, published_at: '2026-09-10T00:00:00Z', assets: [{ name: 'Mindustry.jar' }] },
      { id: 2, tag_name: 'v160.5-BE', prerelease: true, draft: false, published_at: '2026-09-19T00:00:00Z', assets: [{ name: 'Mindustry.jar' }] },
    ];
    const originalGet = https.get;
    https.get = (_url, _options, callback) => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => request.emit('error', error);
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        callback(response);
        response.emit('data', JSON.stringify(releases));
        response.emit('end');
      });
      return request;
    };

    try {
      const stable = await getLatestRelease('Anuken/Mindustry', {
        includePrerelease: true,
        prereleaseOnly: false,
      });
      const prerelease = await getLatestRelease('Anuken/Mindustry', {
        includePrerelease: true,
        prereleaseOnly: true,
      });
      assert.strictEqual(stable.tag_name, 'v160.4');
      assert.strictEqual(prerelease.tag_name, 'v160.5-BE');
    } finally {
      https.get = originalGet;
    }
  });
});
