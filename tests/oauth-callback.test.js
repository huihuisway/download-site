const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('oauth-callback');

process.env.OAUTH_AUTHORIZE_URL = 'https://auth.example.test/api/authorize';
process.env.OAUTH_TOKEN_URL = 'https://auth.example.test/api/token';
process.env.OAUTH_USERINFO_URL = 'https://auth.example.test/api/userinfo';
process.env.OAUTH_CLIENT_ID = 'file-site-test-client';
process.env.OAUTH_CLIENT_SECRET = 'file-site-test-secret';
process.env.OAUTH_CALLBACK_URL = 'https://file.example.test/auth/callback';

const { config } = require('../src/config');
const { handleCallback } = require('../src/routes/oauth');

after(() => tmpEnv.cleanup());

const jsonResponse = (data) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => data,
});

describe('OAuth callback', () => {
  it('在令牌交换时发送发起授权所用的 redirect_uri，并返回原页面', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (url === config.oauth.tokenUrl) {
        return jsonResponse({ access_token: 'synthetic-access-token' });
      }
      if (url === config.oauth.userinfoUrl) {
        return jsonResponse({ sub: 'test-user', name: 'Test User', email: 'TEST@example.test' });
      }
      throw new Error('Unexpected OAuth endpoint');
    };

    const req = {
      query: { code: 'synthetic-auth-code', state: 'synthetic-state' },
      session: {
        oauthState: 'synthetic-state',
        oauthReturnUrl: '/downloads',
        save(callback) { callback(null); },
      },
    };
    const res = {
      statusCode: 200,
      redirectedTo: null,
      status(code) { this.statusCode = code; return this; },
      render(view, data) { this.rendered = { view, data }; return this; },
      redirect(url) { this.redirectedTo = url; return this; },
    };

    try {
      await handleCallback(req, res);

      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, config.oauth.tokenUrl);
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        grant_type: 'authorization_code',
        code: 'synthetic-auth-code',
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
        redirect_uri: config.oauth.callbackUrl,
      });
      assert.equal(calls[1].url, config.oauth.userinfoUrl);
      assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-access-token');
      assert.equal(res.statusCode, 200);
      assert.equal(res.redirectedTo, '/downloads');
      assert.deepEqual(req.session.user, {
        id: 'test-user',
        username: 'Test User',
        email: 'test@example.test',
        authProvider: 'oauth',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
