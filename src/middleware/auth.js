const { config } = require('../config');

// 开发模式测试管理员账户
const DEV_ADMIN_USER = {
  id: 0,
  username: 'dev-admin',
  email: 'dev@localhost',
  isDev: true,
};

const normalizeEmail = (email) => {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
};

const isApiRequest = (req) => {
  const url = req.originalUrl || req.baseUrl || req.path || '';
  return url.startsWith('/api/');
};

// 开发管理员旁路：必须显式设置 DEV_ADMIN_BYPASS=1 且非生产环境才生效
// （运行时读取 env，生产环境下即使误设 flag 也不会生效）
const isDevBypassEnabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.DEV_ADMIN_BYPASS === '1';

const isLocalAdminUser = (user) => {
  if (!user) return false;
  if (user.isLocalAdmin || user.authProvider === 'local') return true;
  return !!(config.admin.username && user.username === config.admin.username && !user.email);
};

const hasAdminAccess = (user) => {
  if (!user) return false;
  if (isLocalAdminUser(user)) return true;
  if (!config.admin.allowedEmails.length) return true;
  return config.admin.allowedEmails.includes(normalizeEmail(user.email));
};

const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    if (!hasAdminAccess(req.session.user)) {
      return res.status(403).json({ error: '无后台权限' });
    }
    return next();
  }

  // 开发模式：仅在显式开启 DEV_ADMIN_BYPASS=1 时自动注入测试管理员
  if (isDevBypassEnabled()) {
    req.session.user = { ...DEV_ADMIN_USER };
    return next();
  }

  // API 请求返回 JSON 错误
  if (isApiRequest(req)) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }

  // 页面请求重定向到登录
  const returnUrl = encodeURIComponent(req.originalUrl);
  return res.redirect(`/auth/login?returnUrl=${returnUrl}`);
};

const attachUser = (req, res, next) => {
  // 开发旁路开启时也注入测试用户到模板
  if (isDevBypassEnabled() && !req.session?.user) {
    res.locals.currentUser = { ...DEV_ADMIN_USER };
  } else {
    res.locals.currentUser = req.session?.user || null;
  }
  next();
};

module.exports = {
  requireAuth,
  attachUser,
  hasAdminAccess,
  isLocalAdminUser,
  isDevBypassEnabled,
  DEV_ADMIN_USER,
};
