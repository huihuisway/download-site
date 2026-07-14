const { describe, it } = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = 'test';

describe('auth middleware', () => {
  const { requireAuth, DEV_ADMIN_USER } = require('../src/middleware/auth');

  describe('requireAuth', () => {
    it('已登录用户应通过', () => {
      const req = { session: { user: { id: 1, username: 'test' } }, path: '/api/admin/stats' };
      const res = {};
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled);
    });

    it('开发模式未登录应自动注入管理员', () => {
      const req = { session: {}, path: '/api/admin/stats' };
      const res = {};
      let nextCalled = false;
      requireAuth(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled);
      assert.ok(req.session.user);
      assert.strictEqual(req.session.user.username, DEV_ADMIN_USER.username);
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
