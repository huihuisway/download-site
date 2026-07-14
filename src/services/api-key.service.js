const crypto = require('crypto');
const { db } = require('../db');

/**
 * 生成随机 API Key
 * 格式：dk_ + 32 位随机 hex
 */
const generateRandomKey = () => {
  return 'dk_' + crypto.randomBytes(16).toString('hex');
};

/**
 * 创建新的 API Key
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
    key: keyString,
    permission,
    created_at: new Date().toISOString(),
    last_used_at: null,
    is_active: true,
  };

  db.data.api_keys.push(record);
  db._save();

  return record;
};

/**
 * 验证 API Key
 * 返回 key 对象，如果无效则返回 null
 */
const validateKey = (keyString) => {
  if (!keyString || typeof keyString !== 'string') return null;

  const record = db.data.api_keys.find((k) => k.key === keyString);
  if (!record || !record.is_active) return null;

  return record;
};

/**
 * 列出所有 API Key（不返回完整 key 字符串，只显示前 8 位）
 */
const listKeys = () => {
  return db.data.api_keys.map((k) => ({
    id: k.id,
    name: k.name,
    key_preview: k.key.substring(0, 8) + '...',
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
 */
const touchKey = (id) => {
  const record = db.data.api_keys.find((k) => k.id === id);
  if (record) {
    record.last_used_at = new Date().toISOString();
    // 不立即保存，由请求流程结束时保存
  }
};

module.exports = {
  generateKey,
  validateKey,
  listKeys,
  revokeKey,
  touchKey,
};
