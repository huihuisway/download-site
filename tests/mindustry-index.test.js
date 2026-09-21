const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('mindustry-index');

describe('Mindustry public manifest', () => {
  let db;

  before(() => {
    db = require('../src/db').db;
    db.data.download_logs = [];
    db._save();

    const stablePath = 'Mindustry/Main/Stable/v160.4/desktop/Mindustry.jar';
    fs.mkdirSync(path.join(tmpEnv.downloadDir, path.dirname(stablePath)), { recursive: true });
    fs.writeFileSync(path.join(tmpEnv.downloadDir, stablePath), 'desktop release');
    db.data.download_logs.push({
      id: 1,
      file_name: 'Mindustry.jar',
      file_path: stablePath,
      file_size: 15,
      sha256: 'a'.repeat(64),
      approval_status: 'approved',
      game_id: 'mindustry',
      game_name: 'Mindustry',
      source_repository: 'Anuken/Mindustry',
      version_tag: 'v160.4',
      release_tag: 'v160.4',
      release_channel: 'stable',
      published_at: '2026-09-10T00:00:00Z',
      release_url: 'https://github.com/Anuken/Mindustry/releases/tag/v160.4',
      platform: 'desktop',
      asset_type: 'desktop',
    });

    const apkPath = 'Mindustry/Main/Stable/v160.4/android/Mindustry-MDT-Android-v160.4.apk';
    fs.mkdirSync(path.join(tmpEnv.downloadDir, path.dirname(apkPath)), { recursive: true });
    fs.writeFileSync(path.join(tmpEnv.downloadDir, apkPath), 'community apk');
    db.data.download_logs.push({
      id: 2,
      file_name: 'Mindustry-MDT-Android-v160.4.apk',
      file_path: apkPath,
      file_size: 13,
      sha256: 'b'.repeat(64),
      approval_status: 'approved',
      game_id: 'mindustry',
      game_name: 'Mindustry',
      source_repository: 'mdtbbs/download-site',
      version_tag: 'v160.4',
      release_tag: 'mdt-mindustry-android-v160.4',
      release_channel: 'stable',
      published_at: '2026-09-11T00:00:00Z',
      release_url: 'https://github.com/mdtbbs/download-site/releases/tag/mdt-mindustry-android-v160.4',
      platform: 'android',
      asset_type: 'installer',
    });

    db.data.download_logs.push({
      id: 3,
      file_name: 'pending.jar',
      file_path: stablePath,
      approval_status: 'pending',
      game_id: 'mindustry',
      version_tag: 'v160.4',
      release_channel: 'stable',
    });
    db._save();
  });

  after(() => tmpEnv.cleanup());

  it('按游戏版本合并官方桌面版与对应 MDT APK，并保留校验和和来源', () => {
    const manifest = require('../src/services/mindustry-index.service').buildManifest();
    const game = manifest.games.find((entry) => entry.id === 'mindustry');
    assert.ok(game);
    const release = game.releases.find((entry) => entry.tag === 'v160.4' && entry.channel === 'stable');
    assert.ok(release);
    assert.deepStrictEqual(new Set(release.source_repositories), new Set(['Anuken/Mindustry', 'mdtbbs/download-site']));
    assert.strictEqual(release.assets.length, 2);
    assert.ok(release.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
    assert.ok(release.assets.every((asset) => asset.download_url.startsWith('/d/')));
  });

  it('不公开 pending 文件或越出下载目录的路径', () => {
    db.data.download_logs.push({
      id: 4,
      file_name: 'outside.jar',
      file_path: '../outside.jar',
      approval_status: 'approved',
      game_id: 'mindustry',
      version_tag: 'v999.9',
      release_channel: 'stable',
    });
    const manifest = require('../src/services/mindustry-index.service').buildManifest();
    const game = manifest.games.find((entry) => entry.id === 'mindustry');
    assert.ok(game);
    assert.ok(game.releases.every((release) => !release.assets.some((asset) => /pending|outside/.test(asset.file_name))));
  });
});
