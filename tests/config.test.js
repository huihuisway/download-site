const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET,
};

const restoreEnv = () => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const loadConfigModule = () => {
  delete require.cache[require.resolve('../src/config')];
  return require('../src/config');
};

describe('config 校验', () => {
  beforeEach(() => {
    restoreEnv();
    process.env.NODE_ENV = 'production';
    // 显式设为占位值，避免机器上存在 .env 时 dotenv 回填导致结果不确定
    process.env.OAUTH_CLIENT_ID = 'your_client_id';
    process.env.OAUTH_CLIENT_SECRET = 'your_client_secret';
  });

  afterEach(() => {
    restoreEnv();
  });

  it('SESSION_SECRET 为默认值时应属于 fatal', () => {
    process.env.SESSION_SECRET = 'dev-secret-change-me';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.length > 0);
    assert.ok(fatal.some((msg) => msg.includes('SESSION_SECRET')));
  });

  it('SESSION_SECRET 过短时应属于 fatal', () => {
    process.env.SESSION_SECRET = 'short-secret';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('32')));
  });

  it('SESSION_SECRET 足够长时不应有 fatal', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.strictEqual(fatal.length, 0);
  });

  it('OAuth 未配置时应产生 warning 而非 fatal', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    const { validateConfig } = loadConfigModule();
    const { fatal, warnings } = validateConfig();
    assert.strictEqual(fatal.length, 0);
    assert.ok(warnings.some((msg) => msg.includes('OAuth')));
  });

  it('OAuth 与本地管理员均未配置时应警告后台不可登录', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const { validateConfig } = loadConfigModule();
    const { warnings } = validateConfig();
    assert.ok(warnings.some((msg) => msg.includes('管理后台将无法登录')));
  });
});
