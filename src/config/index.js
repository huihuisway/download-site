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

  // OAuth 2.0
  oauth: {
    authorizeUrl: process.env.OAUTH_AUTHORIZE_URL,
    tokenUrl: process.env.OAUTH_TOKEN_URL,
    userinfoUrl: process.env.OAUTH_USERINFO_URL,
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    callbackUrl: process.env.OAUTH_CALLBACK_URL,
  },

  // Session
  session: {
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 24 * 60 * 60 * 1000,
  },

  // 上传白名单
  allowedExtensions: (process.env.ALLOWED_EXTENSIONS || '.zip,.pdf,.txt,.png,.jpg')
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
    if (!value || value.startsWith('your_') || value === 'https://forum.example.com') {
      missing.push(key);
    }
  }

  if (missing.length > 0 && config.isProduction) {
    console.warn(`[config] 警告: 以下 OAuth 配置项未正确设置: ${missing.join(', ')}`);
  }

  return missing.length === 0;
};

module.exports = { config, validateConfig };
