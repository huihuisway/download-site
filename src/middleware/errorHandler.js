const errorHandler = (err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.path}:`, err.message);

  // multer 文件上传错误
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件大小超出限制' });
  }

  // 自定义业务错误
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // 路径越界错误
  if (err.message && err.message.includes('路径越界')) {
    return res.status(403).json({ error: err.message });
  }

  // 生产环境隐藏详细错误
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({ error: '服务器内部错误' });
  }

  // 开发环境返回详细信息
  return res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
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
};
