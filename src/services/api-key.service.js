const crypto = require('crypto');
const { db } = require('../db');

// touchKey 防抖落盘：防止高频 API 调用导致的写放大
const TOUCH_SAVE_DELAY_MS = 5000;
let touchSaveTimer = null;

/**
 * 生成随机 API Key
 * 格式：dk_ + 32 位随机 hex
 */
const generateRandomKey = () => {
  return 'dk_' + crypto.randomBytes(16).toString('hex');
};

/**
 * SHA-256 哈希（hex 编码），Key 明文不落盘
 */
const hashKey = (keyString) => {
  return crypto.createHash('sha256').update(keyString).digest('hex');
};

/**
 * 创建新的 API Key
 * 返回值包含完整 key 明文（仅此一次），存储中只保留哈希与前缀
 */
const generateKey = (name, permission = 'read') => {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('请提供 Key 名称');
  }
  if (!['read', 'write'].includes(permission)) {
    throw new Error('权限必须是 read 或 write');
  }

  const keyString = generateRandomKey();
  const id = db.data._nextApiKeyId++;
  const record = {
    id,
    name: name.trim(),
    key_hash: hashKey(keyString),
    key_prefix: keyString.substring(0, 8),
    permission,
    created_at: new Date().toISOString(),
    last_used_at: null,
    is_active: true,
  };

  db.data.api_keys.push(record);
  db._save();

  // 返回完整 key 明文（仅此一次），不外泄内部哈希
  const { key_hash: _omit, ...publicRecord } = record;
  return { ...publicRecord, key: keyString };
};

/**
 * 验证 API Key
 * 返回 key 对象，如果无效则返回 null
 * 使用常量时间比较，防止时序侧信道探测
 */
const validateKey = (keyString) => {
  if (!keyString || typeof keyString !== 'string') return null;

  const incoming = Buffer.from(hashKey(keyString), 'hex');
  const record = db.data.api_keys.find((k) => {
    if (!k.key_hash) return false;
    const stored = Buffer.from(k.key_hash, 'hex');
    return stored.length === incoming.length && crypto.timingSafeEqual(stored, incoming);
  });
  if (!record || !record.is_active) return null;

  return record;
};

/**
 * 列出所有 API Key（只显示前 8 位前缀）
 */
const listKeys = () => {
  return db.data.api_keys.map((k) => ({
    id: k.id,
    name: k.name,
    key_preview: (k.key_prefix || (k.key || '').substring(0, 8)) + '...',
    permission: k.permission,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    is_active: k.is_active,
  }));
};

/**
 * 撤销 API Key
 */
const revokeKey = (id) => {
  const record = db.data.api_keys.find((k) => k.id === id);
  if (!record) {
    throw new Error('Key 不存在');
  }
  record.is_active = false;
  db._save();
  return { revoked: true, id };
};

/**
 * 更新最后使用时间
 * 内存立即生效；落盘走 5 秒防抖合并写，进程优雅退出时由 db.close() 兜底
 */
const touchKey = (id) => {
  const record = db.data.api_keys.find((k) => k.id === id);
  if (!record) return;
  record.last_used_at = new Date().toISOString();
  if (!touchSaveTimer) {
    touchSaveTimer = setTimeout(() => {
      touchSaveTimer = null;
      db._save();
    }, TOUCH_SAVE_DELAY_MS);
    if (touchSaveTimer.unref) touchSaveTimer.unref(); // 不阻止进程退出
  }
};

module.exports = {
  generateKey,
  validateKey,
  listKeys,
  revokeKey,
  touchKey,
};
