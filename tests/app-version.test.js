const test = require('node:test');
const assert = require('node:assert/strict');
const { getAppVersion, normalizeVersion } = require('../src/utils/app-version');

test('normalizeVersion 只接受 v 加数字', () => {
  assert.equal(normalizeVersion('v1234'), 'v1234');
  assert.equal(normalizeVersion(' v42 '), 'v42');
  assert.equal(normalizeVersion('1.0.0'), null);
  assert.equal(normalizeVersion('v1.2'), null);
});

test('getAppVersion 优先使用合法环境版本', () => {
  assert.equal(getAppVersion({ envVersion: 'v9876', gitCommand: 'missing-git' }), 'v9876');
  assert.equal(getAppVersion({ envVersion: 'invalid', gitCommand: 'missing-git' }), 'v0000');
});

test('getAppVersion 从 git 提交计数生成版本', () => {
  const version = getAppVersion({ cwd: process.cwd() });
  assert.match(version, /^v\d+$/);
});
