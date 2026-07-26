const themeService = require('../services/theme.service');

/**
 * 渲染主题化错误页
 * 统一 app.js / oauth.js / public.js 三处此前各自重复的实现。
 * currentTheme 与 siteInfo 显式传入——部分调用点(如 /auth、/admin 守卫)
 * 不经过 public 路由的 res.locals 注入。
 */
const renderThemeError = (res, status, data = {}) => {
  const theme = themeService.getTheme();
  return res.status(status).render(`themes/${theme}/error`, {
    errorType: 'generic',
    fileName: null,
    ...data,
    currentTheme: theme,
    siteInfo: themeService.getSiteInfo(),
  });
};

module.exports = { renderThemeError };
