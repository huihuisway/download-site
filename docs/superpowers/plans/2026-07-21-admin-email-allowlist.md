# Admin Email Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict admin backend access to OAuth users whose email appears in `ADMIN_ALLOWED_EMAILS` in the environment.

**Architecture:** Keep OAuth login behavior unchanged, but enforce admin authorization on the server side in the existing auth middleware. Parse a comma-separated allowlist from config, normalize emails to lowercase, allow local admin login to bypass the OAuth email check, and return `403` for unauthorized admin access.

**Tech Stack:** Node.js, Express, express-session, node:test

## Global Constraints

- Keep OAuth callback behavior unchanged: successful OAuth may still create a session.
- Enforce backend permission on the server, not the frontend.
- Use `.env` variable `ADMIN_ALLOWED_EMAILS` with comma-separated emails.
- Compare emails after trimming whitespace and lowercasing.
- Local admin login via `ADMIN_USERNAME` / `ADMIN_PASSWORD` must keep working.
- Unauthorized admin access should return `403` for backend API requests.

---

### Task 1: Add config support for admin email allowlist

**Files:**
- Modify: `src/config/index.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `process.env.ADMIN_ALLOWED_EMAILS: string | undefined`
- Produces: `config.admin.allowedEmails: string[]`

- [ ] **Step 1: Add failing expectations to config-oriented tests or middleware tests**

```js
assert.deepStrictEqual(config.admin.allowedEmails, ['admin@example.com', 'ops@example.com']);
```

- [ ] **Step 2: Run the relevant auth tests to confirm they do not yet cover allowlist behavior**

Run: `npm test -- tests/auth.test.js`
Expected: PASS without any allowlist coverage yet.

- [ ] **Step 3: Add minimal config parsing**

```js
allowedEmails: (process.env.ADMIN_ALLOWED_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean),
```

- [ ] **Step 4: Document the new env var in `.env.example`**

```env
# ===== 后台邮箱白名单（OAuth） =====
# 只有这些邮箱可访问管理后台，多个邮箱用英文逗号分隔
ADMIN_ALLOWED_EMAILS=admin@example.com,ops@example.com
```

- [ ] **Step 5: Re-run auth tests**

Run: `npm test -- tests/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/index.js .env.example tests/auth.test.js
git commit -m "feat: add admin email allowlist config"
```

### Task 2: Enforce allowlist in auth middleware

**Files:**
- Modify: `src/middleware/auth.js`
- Modify: `tests/auth.test.js`

**Interfaces:**
- Consumes: `config.admin.allowedEmails: string[]`, `req.session.user.email: string | undefined`
- Produces: `requireAuth(req, res, next): void` that returns `403` JSON for disallowed admin API access

- [ ] **Step 1: Write failing middleware tests for unauthorized and authorized OAuth users**

```js
it('白名单外的 OAuth 邮箱访问后台 API 应返回 403', () => {
  process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.com';
  const req = {
    session: { user: { id: 2, username: 'user', email: 'other@example.com' } },
    path: '/api/admin/stats',
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;

  requireAuth(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: '无后台权限' });
});
```

- [ ] **Step 2: Run the focused auth test file and observe failure**

Run: `npm test -- tests/auth.test.js`
Expected: FAIL because middleware currently lets any logged-in user through.

- [ ] **Step 3: Implement minimal allowlist enforcement in middleware**

```js
const { config } = require('../config');

const isLocalAdminUser = (user) => user?.username === config.admin.username && !user?.email;

const isAllowedAdminEmail = (email) => {
  if (!config.admin.allowedEmails.length) return true;
  if (!email || typeof email !== 'string') return false;
  return config.admin.allowedEmails.includes(email.trim().toLowerCase());
};
```

And gate inside `requireAuth` before `next()` for protected admin requests.

- [ ] **Step 4: Re-run the focused auth tests**

Run: `npm test -- tests/auth.test.js`
Expected: PASS, including new `403` behavior.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.js tests/auth.test.js
git commit -m "feat: restrict admin access by email allowlist"
```

### Task 3: Add end-to-end style regression coverage for local admin and unauthorized admin API access

**Files:**
- Modify: `tests/local-login.test.js`

**Interfaces:**
- Consumes: `/auth/local-login`, `/api/admin/stats`, `Cookie` session header
- Produces: regression coverage showing local admin still works and non-whitelisted OAuth-style session is denied

- [ ] **Step 1: Add a failing integration-style test for forbidden admin API access when a session user email is not allowed**

```js
it('非白名单邮箱访问后台 API 应返回 403', async () => {
  // seed a session with user email not in ADMIN_ALLOWED_EMAILS, then call /api/admin/stats
  assert.strictEqual(res.statusCode, 403);
});
```

- [ ] **Step 2: Run the focused local login test file and observe failure or missing coverage**

Run: `npm test -- tests/local-login.test.js`
Expected: FAIL or no coverage for the new forbidden path.

- [ ] **Step 3: Extend the test harness with an app instance configured with `ADMIN_ALLOWED_EMAILS` and verify local admin bypass still works**

```js
process.env.ADMIN_ALLOWED_EMAILS = 'allowed@example.com';
```

Assert that:
- local admin login still reaches `/auth/me` successfully
- a synthetic session user with `other@example.com` cannot access `/api/admin/stats`

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- tests/local-login.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/local-login.test.js
git commit -m "test: cover admin email allowlist"
```

## Self-Review

- Spec coverage: config shape, server-side enforcement, local admin bypass, and test verification are all covered by Tasks 1-3.
- Placeholder scan: no `TODO`/`TBD` markers remain.
- Type consistency: `config.admin.allowedEmails` is introduced once and consumed consistently by middleware/tests.
