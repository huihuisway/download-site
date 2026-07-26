const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

describe('checksum service', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsite-checksum-'));
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('流式哈希结果应与一次性哈希一致', async () => {
    const { computeChecksum } = require('../src/services/checksum.service');
    const filePath = path.join(tmpDir, 'data.bin');
    // 写入 1MB 随机数据，跨多个 chunk
    const payload = crypto.randomBytes(1024 * 1024);
    fs.writeFileSync(filePath, payload);

    const expected = crypto.createHash('sha256').update(payload).digest('hex');
    const actual = await computeChecksum(filePath);
    assert.strictEqual(actual, expected);
  });

  it('文件不存在时应 reject', async () => {
    const { computeChecksum } = require('../src/services/checksum.service');
    await assert.rejects(() => computeChecksum(path.join(tmpDir, 'missing.bin')));
  });
});
