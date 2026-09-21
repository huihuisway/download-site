const { describe, it, after } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';
process.env.MINDUSTRY_ANDROID_RELEASE_REPOSITORY = 'mdtbbs/download-site';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('release-source');

describe('Mindustry release source setup', () => {
  after(() => tmpEnv.cleanup());

  it('主线和 Classic 只配置最新正式版/预发布版，MDT Android 只跟随最新稳定 APK', () => {
    const service = require('../src/services/release-source.service');
    const created = service.ensureMindustrySources();
    assert.strictEqual(created.length, 3);

    const sources = service.list();
    const main = sources.find((source) => source.repo === 'Mindustry' && source.owner === 'Anuken');
    const classic = sources.find((source) => source.repo === 'Mindustry-Classic' && source.owner === 'Anuken');
    const android = sources.find((source) => source.repo === 'download-site' && source.owner === 'mdtbbs');
    assert.ok(main);
    assert.ok(classic);
    assert.ok(android);
    assert.deepStrictEqual(main.config, undefined);
    assert.deepStrictEqual(classic.config, undefined);
    assert.strictEqual(main.include_prerelease, true);
    assert.strictEqual(classic.include_prerelease, true);

    const db = require('../src/db').db;
    const mainRaw = db.data.release_sources.find((source) => source.id === main.id);
    const classicRaw = db.data.release_sources.find((source) => source.id === classic.id);
    const androidRaw = db.data.release_sources.find((source) => source.id === android.id);
    assert.deepStrictEqual(mainRaw.config.sync_latest_channels, ['stable', 'prerelease']);
    assert.deepStrictEqual(classicRaw.config.sync_latest_channels, ['stable', 'prerelease']);
    assert.strictEqual(androidRaw.config.sync_latest_only, true);
    assert.strictEqual(androidRaw.include_prerelease, false);
    assert.match(androidRaw.asset_include_pattern, /Mindustry-MDT-Android/);
  });

  it('会把已有 Mindustry 来源升级为最新版本同步策略', () => {
    const service = require('../src/services/release-source.service');
    const db = require('../src/db').db;
    const main = db.data.release_sources.find((source) => source.owner === 'Anuken' && source.repo === 'Mindustry');
    main.config = { game_id: 'mindustry' };
    db._save();

    assert.deepStrictEqual(service.ensureMindustrySources(), []);
    assert.deepStrictEqual(main.config.sync_latest_channels, ['stable', 'prerelease']);
  });

  it('会把早期错误的 Classic 来源迁移到真实仓库名', () => {
    const service = require('../src/services/release-source.service');
    const db = require('../src/db').db;
    const classic = db.data.release_sources.find((source) => source.owner === 'Anuken' && source.repo === 'Mindustry-Classic');
    classic.repo = 'MindustryClassic';
    db._save();

    service.ensureMindustrySources();
    assert.strictEqual(classic.repo, 'Mindustry-Classic');
    assert.strictEqual(classic.enabled, true);
  });
});
