const path = require('path');
require('dotenv').config();

const config = {
  // 服务配置
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // 文件存储
  downloadDir: path.resolve(process.env.DOWNLOAD_DIR || './downloads'),
  dbPath: path.resolve(process.env.DB_PATH || './data/stats.db'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 100 * 1024 * 1024,

  // OAuth 2.0（MindAuth）
  oauth: {
    authorizeUrl: process.env.OAUTH_AUTHORIZE_URL,
    tokenUrl: process.env.OAUTH_TOKEN_URL,
    userinfoUrl: process.env.OAUTH_USERINFO_URL,
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    callbackUrl: process.env.OAUTH_CALLBACK_URL,
  },

  // 本地管理员（论坛未上线时的临时方案）
  admin: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
    allowedEmails: (process.env.ADMIN_ALLOWED_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  },

  // Session
  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000,
  },

  // 上传白名单
  allowedExtensions: (process.env.ALLOWED_EXTENSIONS || '.zip,.pdf,.txt,.png,.jpg,.jar')
    .split(',')
    .map((ext) => ext.trim().toLowerCase()),

  // 日志
  logLevel: process.env.LOG_LEVEL || 'info',
};

const validateConfig = () => {
  const required = ['oauth.authorizeUrl', 'oauth.tokenUrl', 'oauth.clientId', 'oauth.clientSecret', 'oauth.callbackUrl'];
  const missing = [];

  for (const key of required) {
    const parts = key.split('.');
    let value = config;
    for (const part of parts) {
      value = value?.[part];
    }
    if (!value || value.startsWith('your_') || value.includes('example.com')) {
      missing.push(key);
    }
  }

  // 检查 session secret 安全性
  const sessionSecretWarnings = [];
  if (config.session.secret === 'dev-secret-change-me') {
    sessionSecretWarnings.push('SESSION_SECRET 使用默认值，请设置安全的随机字符串');
  }
  if (config.session.secret && config.session.secret.length < 32) {
    sessionSecretWarnings.push('SESSION_SECRET 长度不足 32 字符，建议使用更长的随机字符串');
  }

  if (missing.length > 0 && config.isProduction) {
    console.warn(`[config] 警告: 以下 OAuth 配置项未正确设置: ${missing.join(', ')}`);
  }

  if (sessionSecretWarnings.length > 0 && config.isProduction) {
    for (const warning of sessionSecretWarnings) {
      console.error(`[config] 严重警告: ${warning}`);
    }
  }

  return missing.length === 0 && sessionSecretWarnings.length === 0;
};

module.exports = { config, validateConfig };
