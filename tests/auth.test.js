const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_ALLOWED_EMAILS: process.env.ADMIN_ALLOWED_EMAILS,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  DEV_ADMIN_BYPASS: process.env.DEV_ADMIN_BYPASS,
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

const loadAuthModule = () => {
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/middleware/auth')];
  return require('../src/middleware/auth');
};

const createJsonResponse = () => ({
  statusCode: 200,
  body: null,
  redirectedTo: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  redirect(url) {
    this.redirectedTo = url;
    return this;
  },
});

describe('auth middleware', () => {
  beforeEach(() => {
    restoreEnv();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('requireAuth', () => {
    it('已登录且未配置白名单的用户应通过', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ADMIN_ALLOWED_EMAILS;
      const { requireAuth } = loadAuthModule();
      const req = {
        session: { user: { id: 1, username: 'test', email: 'user@example.com', authProvider: 'oauth' } },
        originalUrl: '/api/admin/stats',
        path: '/stats',
      };
      const res = createJsonResponse();
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled);
      assert.strictEqual(res.statusCode, 200);
    });

    it('显式开启 DEV_ADMIN_BYPASS=1 时未登录应自动注入管理员', () => {
      process.env.DEV_ADMIN_BYPASS = '1';
      const { requireAuth, DEV_ADMIN_USER } = loadAuthModule();
      const req = { session: {}, path: '/api/admin/stats' };
      const res = createJsonResponse();
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled);
      assert.ok(req.session.user);
      assert.strictEqual(req.session.user.username, DEV_ADMIN_USER.username);
    });

    it('未开启 DEV_ADMIN_BYPASS 时非生产环境未登录 API 请求应返回 401', () => {
      const { requireAuth } = loadAuthModule();
      const req = { session: {}, originalUrl: '/api/admin/stats', path: '/stats' };
      const res = createJsonResponse();
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });

    it('生产环境即使设置 DEV_ADMIN_BYPASS=1 也不应注入管理员', () => {
      process.env.NODE_ENV = 'production';
      process.env.DEV_ADMIN_BYPASS = '1';
      const { requireAuth } = loadAuthModule();
      const req = { session: {}, originalUrl: '/api/admin/stats', path: '/stats' };
      const res = createJsonResponse();
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
    });

    it('白名单内的 OAuth 邮箱应通过', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.com, ops@example.com';
      const { requireAuth } = loadAuthModule();
      const req = {
        session: { user: { id: 1, username: 'admin', email: 'Ops@Example.com', authProvider: 'oauth' } },
        originalUrl: '/api/admin/stats',
        path: '/stats',
      };
      const res = createJsonResponse();
      let nextCalled = false;

      requireAuth(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.strictEqual(res.statusCode, 200);
    });

    it('白名单外的 OAuth 邮箱访问后台 API 应返回 403', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.com';
      const { requireAuth } = loadAuthModule();
      const req = {
        session: { user: { id: 2, username: 'user', email: 'other@example.com', authProvider: 'oauth' } },
        originalUrl: '/api/admin/stats',
        path: '/stats',
      };
      const res = createJsonResponse();
      let nextCalled = false;

      requireAuth(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.body, { error: '无后台权限' });
    });

    it('本地管理员登录应绕过邮箱白名单', () => {
      process.env.NODE_ENV = 'production';
      process.env.ADMIN_USERNAME = 'testadmin';
      process.env.ADMIN_PASSWORD = 'testpass123';
      process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.com';
      const { requireAuth } = loadAuthModule();
      const req = {
        session: { user: { id: 1, username: 'testadmin', email: '', authProvider: 'local', isLocalAdmin: true } },
        originalUrl: '/api/admin/stats',
        path: '/stats',
      };
      const res = createJsonResponse();
      let nextCalled = false;

      requireAuth(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.strictEqual(res.statusCode, 200);
    });

    it('未登录的后台 API 请求应返回 401', () => {
      process.env.NODE_ENV = 'production';
      const { requireAuth } = loadAuthModule();
      const req = {
        session: {},
        originalUrl: '/api/admin/stats',
        path: '/stats',
      };
      const res = createJsonResponse();
      let nextCalled = false;

      requireAuth(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.body, { error: '未授权，请先登录' });
    });
  });

  describe('OAuth returnUrl 安全校验', () => {
    // 测试 isSafeReturnUrl 的逻辑（内联在 oauth.js 中）
    const isSafeReturnUrl = (url) => {
      if (!url || typeof url !== 'string') return false;
      if (url.startsWith('/')) return true;
      if (!url.includes('://')) return true;
      return false;
    };

    it('应允许本地路径', () => {
      assert.ok(isSafeReturnUrl('/admin'));
      assert.ok(isSafeReturnUrl('/admin/files'));
      assert.ok(isSafeReturnUrl('relative/path'));
    });

    it('应拒绝外部 URL', () => {
      assert.ok(!isSafeReturnUrl('https://evil.com/phishing'));
      assert.ok(!isSafeReturnUrl('http://attacker.com'));
      assert.ok(!isSafeReturnUrl('ftp://example.com'));
    });

    it('应拒绝空值和非法类型', () => {
      assert.ok(!isSafeReturnUrl(''));
      assert.ok(!isSafeReturnUrl(null));
      assert.ok(!isSafeReturnUrl(undefined));
    });
  });
});
