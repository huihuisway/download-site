const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { config } = require('../config');

// app.set('trust proxy', true) 会触发 v7 的 ERR_ERL_PERMISSIVE_TRUST_PROXY
// 校验，需显式关闭；反向代理(Cloudflare)场景下 req.ip 即为真实客户端 IP
const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false },
};

// 本地登录：15 分钟窗口，防密码爆破（只统计失败尝试）
const loginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimit.loginMax,
  skipSuccessfulRequests: true,
  message: { error: '登录尝试次数过多，请 15 分钟后再试' },
});

// 公开 API：认证后按 Key 限流，未认证回退按 IP
const apiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: config.rateLimit.apiMax,
  keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : ipKeyGenerator(req.ip)),
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
    }),
});

// 下载：每分钟每 IP
const downloadLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: config.rateLimit.downloadMax,
  message: { error: '下载请求过于频繁，请稍后再试' },
});

module.exports = { loginLimiter, apiLimiter, downloadLimiter };
