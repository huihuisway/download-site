const { db } = require('./index');

const migrations = [
  {
    version: 1,
    description: '初始表结构',
    up: () => {
      // schema.sql 已处理初始建表
    },
  },
  {
    version: 2,
    description: 'API Key 明文改为 SHA-256 哈希存储',
    up: () => {
      const crypto = require('crypto');
      for (const k of db.data.api_keys || []) {
        if (k.key && !k.key_hash) {
          k.key_hash = crypto.createHash('sha256').update(k.key).digest('hex');
          k.key_prefix = k.key.substring(0, 8);
          delete k.key; // 删除明文
        }
      }
    },
  },
  {
    version: 3,
    description: 'GitHub Releases 同步记录',
    up: () => {
      if (!db.data.release_sync) db.data.release_sync = [];
    },
  },
];

const getSchemaVersion = () => {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
    if (!row) return 0;
    const result = db.prepare('SELECT MAX(version) as version FROM _migrations').get();
    return result?.version || 0;
  } catch {
    return 0;
  }
};

const runMigrations = () => {
  const currentVersion = getSchemaVersion();

  // 创建迁移追踪表
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT,
      applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    return;
  }

  const runBatch = db.transaction((migrationsToRun) => {
    for (const migration of migrationsToRun) {
      migration.up();
      db.prepare('INSERT INTO _migrations (version, description) VALUES (?, ?)').run(
        migration.version,
        migration.description,
      );
    }
  });

  runBatch(pendingMigrations);
};

module.exports = { runMigrations, getSchemaVersion };
