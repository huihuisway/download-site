const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET,
  OAUTH_AUTHORIZE_URL: process.env.OAUTH_AUTHORIZE_URL,
  OAUTH_TOKEN_URL: process.env.OAUTH_TOKEN_URL,
  OAUTH_USERINFO_URL: process.env.OAUTH_USERINFO_URL,
  OAUTH_CALLBACK_URL: process.env.OAUTH_CALLBACK_URL,
  ADMIN_ALLOWED_EMAILS: process.env.ADMIN_ALLOWED_EMAILS,
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
  DOWNLOAD_BASE_URL: process.env.DOWNLOAD_BASE_URL,
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
    process.env.OAUTH_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CLIENT_SECRET = 'test-client-secret';
    process.env.OAUTH_AUTHORIZE_URL = 'https://auth.mdtbbs.cn/api/authorize';
    process.env.OAUTH_TOKEN_URL = 'https://auth.mdtbbs.cn/api/token';
    process.env.OAUTH_USERINFO_URL = 'https://auth.mdtbbs.cn/api/userinfo';
    process.env.OAUTH_CALLBACK_URL = 'https://file.mdtbbs.cn/auth/callback';
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@mdtbbs.cn';
    process.env.DOWNLOAD_BASE_URL = 'https://d.file.mdtbbs.cn';
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

  it('OAuth 未配置且没有本地登录时应阻止生产启动', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.OAUTH_CLIENT_ID = 'your_client_id';
    process.env.OAUTH_CLIENT_SECRET = 'your_client_secret';
    const { validateConfig } = loadConfigModule();
    const { fatal, warnings } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('必须配置完整 MindAuth OAuth')));
    assert.ok(warnings.some((msg) => msg.includes('OAuth')));
  });

  it('OAuth 与本地管理员均未配置时应警告后台不可登录', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    process.env.OAUTH_CLIENT_ID = 'your_client_id';
    process.env.OAUTH_CLIENT_SECRET = 'your_client_secret';
    process.env.OAUTH_AUTHORIZE_URL = 'your_authorize_url';
    process.env.OAUTH_TOKEN_URL = 'your_token_url';
    process.env.OAUTH_USERINFO_URL = 'your_userinfo_url';
    process.env.OAUTH_CALLBACK_URL = 'your_callback_url';
    const { validateConfig } = loadConfigModule();
    const { fatal, warnings } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('必须配置完整 MindAuth OAuth')));
    assert.ok(warnings.some((msg) => msg.includes('管理后台将无法登录')));
  });

  it('本地管理员密码过弱时应阻止生产启动', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.OAUTH_CLIENT_ID = 'your_client_id';
    process.env.OAUTH_CLIENT_SECRET = 'your_client_secret';
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'change_me_to_a_strong_password';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('ADMIN_PASSWORD')));
  });

  it('完整 OAuth 未设置后台邮箱白名单时应阻止生产启动', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    delete process.env.ADMIN_ALLOWED_EMAILS;
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('ADMIN_ALLOWED_EMAILS')));
  });

  it('强密码本地管理员可独立满足生产登录要求', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.OAUTH_CLIENT_ID = 'your_client_id';
    process.env.OAUTH_CLIENT_SECRET = 'your_client_secret';
    delete process.env.ADMIN_ALLOWED_EMAILS;
    process.env.ADMIN_USERNAME = 'deployment-admin';
    process.env.ADMIN_PASSWORD = 'a-long-unique-local-password-2026';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.strictEqual(fatal.length, 0);
  });

  it('OAuth 白名单不能使用 example.com 示例地址', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.com';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('示例占位地址')));
  });

  it('生产环境应拒绝无效的反向代理跳数', () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.TRUST_PROXY_HOPS = 'true';
    const { validateConfig } = loadConfigModule();
    const { fatal } = validateConfig();
    assert.ok(fatal.some((msg) => msg.includes('TRUST_PROXY_HOPS')));
  });
});
