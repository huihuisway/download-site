// 开发模式测试管理员账户
const DEV_ADMIN_USER = {
  id: 0,
  username: 'dev-admin',
  email: 'dev@localhost',
  isDev: true,
};

const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }

  // 开发模式：自动注入测试管理员
  if (process.env.NODE_ENV !== 'production') {
    req.session.user = { ...DEV_ADMIN_USER };
    return next();
  }

  // API 请求返回 JSON 错误
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '未授权，请先登录' });
  }

  // 页面请求重定向到登录
  const returnUrl = encodeURIComponent(req.originalUrl);
  return res.redirect(`/auth/login?returnUrl=${returnUrl}`);
};

const attachUser = (req, res, next) => {
  // 开发模式下也注入测试用户到模板
  if (process.env.NODE_ENV !== 'production' && !req.session?.user) {
    res.locals.currentUser = { ...DEV_ADMIN_USER };
  } else {
    res.locals.currentUser = req.session?.user || null;
  }
  next();
};

module.exports = {
  requireAuth,
  attachUser,
  DEV_ADMIN_USER,
};
