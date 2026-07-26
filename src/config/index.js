const path = require('path');
const { MAX_FILE_SIZE } = require('./constants');
require('dotenv').config();

const config = {
  // 服务配置
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // 文件存储
  downloadDir: path.resolve(process.env.DOWNLOAD_DIR || './downloads'),
  dbPath: path.resolve(process.env.DB_PATH || './data/stats.db'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || MAX_FILE_SIZE,

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

  // 速率限制
  rateLimit: {
    loginMax: parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10) || 5,        // 每 15 分钟每 IP
    apiMax: parseInt(process.env.RATE_LIMIT_API_MAX, 10) || 120,          // 每分钟每 Key
    downloadMax: parseInt(process.env.RATE_LIMIT_DOWNLOAD_MAX, 10) || 60, // 每分钟每 IP
  },

  // 日志
  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * 校验配置安全性。
 * 返回 { fatal, warnings }：fatal 在生产环境应拒绝启动（由调用方执行 process.exit），
 * warnings 仅提示。OAuth 缺失保持 warning——仅用本地管理员登录是受支持的部署模式。
 */
const validateConfig = () => {
  const fatal = [];
  const warnings = [];

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
  if (missing.length > 0) {
    warnings.push(`以下 OAuth 配置项未正确设置: ${missing.join(', ')}`);
  }

  // 未配置任何登录方式时后台将不可用
  if (missing.length > 0 && !(config.admin.username && config.admin.password)) {
    warnings.push('OAuth 与本地管理员（ADMIN_USERNAME/ADMIN_PASSWORD）均未配置，管理后台将无法登录');
  }

  // session secret 不安全在生产环境属于致命错误
  if (config.session.secret === 'dev-secret-change-me') {
    fatal.push('SESSION_SECRET 使用默认值，请设置安全的随机字符串');
  } else if (config.session.secret.length < 32) {
    fatal.push('SESSION_SECRET 长度不足 32 字符，请使用更长的随机字符串');
  }

  return { fatal, warnings };
};

module.exports = { config, validateConfig };
