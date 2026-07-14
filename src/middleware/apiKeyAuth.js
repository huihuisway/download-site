const { validateKey, touchKey } = require('../services/api-key.service');

/**
 * API Key 认证中间件
 * 从 Authorization: Bearer dk_xxx 提取并验证 Key
 */
const apiKeyAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: '缺少 API Key，请在 Header 中传递 Authorization: Bearer <your-key>',
      },
    });
  }

  const keyString = authHeader.substring(7); // 去掉 "Bearer "
  const apiKey = validateKey(keyString);

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'API Key 无效或已被撤销',
      },
    });
  }

  // 挂载到请求对象
  req.apiKey = apiKey;

  // 更新最后使用时间
  touchKey(apiKey.id);

  next();
};

/**
 * 写权限检查中间件
 * 必须配合 apiKeyAuth 使用
 */
const requireWritePermission = (req, res, next) => {
  if (!req.apiKey || req.apiKey.permission !== 'write') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: '此 API Key 仅有只读权限，无法执行写操作',
      },
    });
  }
  next();
};

module.exports = {
  apiKeyAuth,
  requireWritePermission,
};
