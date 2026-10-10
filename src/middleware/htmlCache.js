/**
 * 动态响应的缓存策略。
 *
 * Express 默认不给 HTML 加 Cache-Control，CDN（EdgeOne 等）会按
 * Last-Modified 做启发式缓存（可达数天），于是页面/通知/同步状态改动后，
 * 用户长时间看到旧内容——线上曾出现文件详情页被 CDN 缓存 6 天。
 *
 * 给「没有显式设置缓存头」的动态响应补 no-cache：
 * 浏览器与 CDN 仍可存储 + 用 ETag 协商（304 省流量），但每次都会回源校验，
 * 不会出现「页面标题、通知、状态是几天前的」。
 * 静态资源、API 短缓存、下载响应都自带 Cache-Control，不会被动到。
 */
const applyCachePolicy = (req, res, next) => {
  const originalWriteHead = res.writeHead;
  res.writeHead = function writeHeadWithCachePolicy(...args) {
    if (!res.getHeader('Cache-Control')) {
      const contentType = res.getHeader('Content-Type');
      const isHtml = typeof contentType === 'string' && contentType.includes('text/html');
      // 304 已无 Content-Type：沿用先前的 no-cache，避免 CDN 又按启发式缓存
      if (isHtml || res.statusCode === 304) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
    return originalWriteHead.apply(this, args);
  };
  next();
};

module.exports = { applyCachePolicy };
