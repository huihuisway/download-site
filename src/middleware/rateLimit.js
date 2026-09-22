const { rateLimit } = require('express-rate-limit');
const ipaddr = require('ipaddr.js');
const { config } = require('../config');

// express-rate-limit v7 does not export ipKeyGenerator. Normalize IPv6
// addresses to /56 so clients cannot bypass limits by rotating interface IDs.
const ipRateLimitKey = (ip) => {
  const address = ipaddr.process(ip);
  if (address.kind() !== 'ipv6') return address.toString();
  const networkBytes = address.toByteArray();
  networkBytes.fill(0, 7);
  return ipaddr.fromByteArray(networkBytes).toNormalizedString();
};

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
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
  keyGenerator: (req) => (req.apiKey ? `key:${req.apiKey.id}` : `ip:${ipRateLimitKey(req.ip)}`),
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

// 前端下载计数上报：每分钟每 IP（与下载限流同配置）
const countDownloadLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: config.rateLimit.downloadMax,
  message: { error: '请求过于频繁，请稍后再试' },
});

module.exports = { loginLimiter, apiLimiter, downloadLimiter, countDownloadLimiter, ipRateLimitKey };
