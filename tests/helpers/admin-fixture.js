const fs = require('fs');
const path = require('path');

/**
 * 后台 SPA 回退路由的测试依赖 public/admin 构建产物，
 * 而产物不入库（见 .gitignore），干净检出 / CI 上并不存在
 * ——直接跑 npm test 会红 3 项。
 *
 * 这里在缺少产物时补一个最小夹具（index.html + 一个模块 JS），
 * 让测试验证「SPA 回退与静态资源 MIME」这件事本身，而不是构建工具链。
 * 已存在真实构建时不覆盖；先写资源再写 index.html，避免并发读半成品。
 */
const ADMIN_DIR = path.join(__dirname, '..', '..', 'public', 'admin');

const ensureAdminFixture = () => {
  const indexFile = path.join(ADMIN_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return false;

  fs.mkdirSync(path.join(ADMIN_DIR, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(ADMIN_DIR, 'assets', 'index-fixture.js'), 'export default {};\n');
  fs.writeFileSync(indexFile, [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><title>后台夹具</title></head>',
    '<body><div id="root"></div>',
    '<script type="module" crossorigin src="/admin/assets/index-fixture.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n'));
  return true;
};

module.exports = { ensureAdminFixture, ADMIN_DIR };
