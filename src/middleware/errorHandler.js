const { config } = require('../config');

/**
 * 把错误映射为 { status, message }
 * stack 只进日志，永不返回给客户端
 */
const classifyError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, message: '文件大小超出限制' };
  }
  if (err.statusCode) {
    return { status: err.statusCode, message: err.message };
  }
  if (err.message && err.message.includes('路径越界')) {
    return { status: 403, message: err.message };
  }
  // 生产环境隐藏内部错误细节
  return { status: 500, message: config.isProduction ? '服务器内部错误' : err.message };
};

const errorHandler = (err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message, config.isProduction ? '' : err.stack);

  // 响应头已发出（如流传输中途出错）时无法再改写响应
  if (res.headersSent) {
    return;
  }

  const { status, message } = classifyError(err);

  // 内容协商：API 请求返回 JSON，浏览器请求渲染主题化错误页
  const wantsHtml = !req.path.startsWith('/api/') && req.accepts(['html', 'json']) === 'html';
  if (!wantsHtml) {
    return res.status(status).json({ error: message });
  }

  try {
    const themeService = require('../services/theme.service');
    const theme = themeService.getTheme();
    return res.status(status).render(`themes/${theme}/error`, {
      title: '出错了',
      message,
      errorType: 'generic',
      fileName: null,
      currentTheme: theme,
      siteInfo: themeService.getSiteInfo(),
    });
  } catch (renderErr) {
    console.error('[error] 错误页渲染失败:', renderErr.message);
    return res.status(status).type('text').send(message);
  }
};

const notFoundHandler = (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  const themeService = require('../services/theme.service');
  const theme = themeService.getTheme();
  return res.status(404).render(`themes/${theme}/404`, { title: '页面未找到' });
};

module.exports = {
  errorHandler,
  notFoundHandler,
  classifyError,
};
