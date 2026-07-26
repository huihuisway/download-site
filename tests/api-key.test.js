const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('api-key');

describe('api key service', () => {
  before(() => {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    const { db } = require('../src/db');
    db.data.api_keys = [];
    db.data._nextApiKeyId = 1;
    db._save();
  });

  after(() => {
    tmpEnv.cleanup();
  });

  it('生成的 Key 只存哈希与前缀,不存明文', () => {
    const apiKeyService = require('../src/services/api-key.service');
    const { db } = require('../src/db');

    const result = apiKeyService.generateKey('测试 Key', 'read');
    assert.match(result.key, /^dk_[0-9a-f]{32}$/);
    assert.strictEqual(result.key_hash, undefined); // 响应中不暴露哈希

    const stored = db.data.api_keys.find((k) => k.id === result.id);
    assert.strictEqual(stored.key, undefined); // 存储无明文
    assert.match(stored.key_hash, /^[0-9a-f]{64}$/);
    assert.strictEqual(stored.key_prefix, result.key.substring(0, 8));
  });

  it('validateKey 对正确/错误/撤销的 Key 行为正确', () => {
    const apiKeyService = require('../src/services/api-key.service');

    const created = apiKeyService.generateKey('校验 Key', 'write');
    const valid = apiKeyService.validateKey(created.key);
    assert.ok(valid);
    assert.strictEqual(valid.id, created.id);
    assert.strictEqual(valid.permission, 'write');

    assert.strictEqual(apiKeyService.validateKey('dk_' + '0'.repeat(32)), null);
    assert.strictEqual(apiKeyService.validateKey(''), null);

    apiKeyService.revokeKey(created.id);
    assert.strictEqual(apiKeyService.validateKey(created.key), null);
  });

  it('listKeys 只展示前缀', () => {
    const apiKeyService = require('../src/services/api-key.service');
    const keys = apiKeyService.listKeys();
    assert.ok(keys.length > 0);
    for (const k of keys) {
      assert.match(k.key_preview, /^dk_[0-9a-f]{5}\.\.\.$/);
      assert.strictEqual(k.key, undefined);
      assert.strictEqual(k.key_hash, undefined);
    }
  });

  it('迁移 v2 应哈希化存量明文 Key 且旧 Key 仍可验证', () => {
    const apiKeyService = require('../src/services/api-key.service');
    const { db } = require('../src/db');
    const { runMigrations } = require('../src/db/migrations');

    const legacyKey = 'dk_' + 'ab'.repeat(16);
    db.data.api_keys.push({
      id: 99,
      name: 'legacy',
      key: legacyKey,
      permission: 'read',
      created_at: new Date().toISOString(),
      last_used_at: null,
      is_active: true,
    });
    db.data._migrations = [];  // 强制迁移重跑（幂等,存量已哈希的记录不受影响）
    runMigrations();

    const migrated = db.data.api_keys.find((k) => k.id === 99);
    assert.strictEqual(migrated.key, undefined);
    assert.match(migrated.key_hash, /^[0-9a-f]{64}$/);
    assert.strictEqual(migrated.key_prefix, legacyKey.substring(0, 8));

    const valid = apiKeyService.validateKey(legacyKey);
    assert.ok(valid);
    assert.strictEqual(valid.id, 99);
  });

  it('touchKey 应更新内存并在落盘后持久化', () => {
    const apiKeyService = require('../src/services/api-key.service');
    const { db } = require('../src/db');

    const created = apiKeyService.generateKey('touch Key', 'read');
    apiKeyService.touchKey(created.id);

    const inMemory = db.data.api_keys.find((k) => k.id === created.id);
    assert.ok(inMemory.last_used_at); // 内存立即生效

    db._save(); // 模拟防抖定时器/优雅退出的落盘
    const onDisk = JSON.parse(fs.readFileSync(process.env.DB_PATH, 'utf8'));
    const persisted = onDisk.api_keys.find((k) => k.id === created.id);
    assert.ok(persisted.last_used_at);
  });
});
