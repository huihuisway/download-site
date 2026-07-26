const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const { config, validateConfig } = require('./config');

// 确保数据库初始化
require('./db');
const { runMigrations } = require('./db/migrations');

// 路由
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const oauthController = require('./routes/oauth');
const apiV1Routes = require('./routes/api-v1');

// 中间件
const { attachUser, hasAdminAccess } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// 服务初始化
const { syncDirectory } = require('./services/sync.service');
const themeService = require('./services/theme.service');

const app = express();

const renderThemeError = (res, status, title, message) => {
  const theme = themeService.getTheme();
  return res.status(status).render(`themes/${theme}/error`, {
    title,
    message,
    currentTheme: theme,
    siteInfo: themeService.getSiteInfo(),
  });
};

// ===== 基础中间件 =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 信任反向代理（Cloudflare 等），使 req.secure / X-Forwarded-Proto 生效
// 必须在 session 中间件之前设置，否则 secure cookie 无法在代理后正常下发
app.set('trust proxy', true);

app.use(helmet({
  contentSecurityPolicy: false,  // 允许内联样式
  crossOriginEmbedderPolicy: false,
}));

if (!config.isProduction) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('short'));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Session 配置 =====
const sessionDir = path.join(__dirname, '..', 'data', 'sessions');
fs.mkdirSync(sessionDir, { recursive: true });

app.use(session({
  store: new FileStore({
    path: sessionDir,
    ttl: config.session.maxAge / 1000,
    retries: 0,
    logFn: () => {},
  }),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,  // 匿名访客不落 session 文件，防止 data/sessions 无限膨胀
  cookie: {
    maxAge: config.session.maxAge,
    httpOnly: true,
    // 'auto' 依据 X-Forwarded-Proto 判断（trust proxy 已开）：
    // HTTPS 请求下发 Secure cookie，CDN 回源 HTTP 场景也能正常工作
    secure: config.isProduction ? 'auto' : false,
    sameSite: 'strict',
  },
}));

// 后台 React SPA
app.use('/admin', (req, res, next) => {
  if (req.session?.user && !hasAdminAccess(req.session.user)) {
    return renderThemeError(res, 403, '无后台权限', '当前账号没有管理后台权限，请联系管理员添加邮箱白名单。');
  }
  return next();
});
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin'), {
  index: false,
  redirect: false,
}));
app.get(['/admin', '/admin/*'], (req, res) => {
  const adminIndex = path.join(__dirname, '..', 'public', 'admin', 'index.html');
  if (fs.existsSync(adminIndex)) {
    return res.sendFile(adminIndex);
  }
  return renderThemeError(res, 404, '后台未构建', '请先运行 npm run build:admin 构建后台前端。');
});

// ===== 静态资源 =====
app.use(express.static(path.join(__dirname, '..', 'public')));

// ===== 注入用户信息到模板 =====
app.use(attachUser);

// ===== OAuth 路由 =====
const oauthRouter = express.Router();
oauthRouter.get('/login', oauthController.startOAuthFlow);
oauthRouter.get('/callback', oauthController.handleCallback);
oauthRouter.get('/logout', oauthController.logout);
oauthRouter.get('/me', oauthController.getMe);
oauthRouter.get('/config', oauthController.getAuthConfig);
oauthRouter.post('/local-login', oauthController.localLogin);
app.use('/auth', oauthRouter);

// ===== 后台 API =====
app.use('/api/admin', adminRoutes);

// ===== 第三方公开 API =====
app.use('/api/v1', apiV1Routes);

// ===== 前台路由 =====
app.use('/', publicRoutes);

// ===== 错误处理 =====
app.use(notFoundHandler);
app.use(errorHandler);

// ===== 启动服务 =====
const startServer = async () => {
  // 先校验配置：生产环境下不安全的配置直接拒绝启动
  const { fatal, warnings } = validateConfig();
  warnings.forEach((w) => console.warn(`[config] 警告: ${w}`));
  if (fatal.length > 0) {
    fatal.forEach((e) => console.error(`[config] ${config.isProduction ? '致命错误' : '严重警告'}: ${e}`));
    if (config.isProduction) {
      process.exit(1);
    }
  }

  // 运行数据库迁移
  runMigrations();

  // 启动时自动同步目录
  console.log('[init] 正在同步文件目录...');
  try {
    const result = await syncDirectory();
    console.log(`[init] 同步完成: 新增 ${result.inserted}, 更新 ${result.updated}, 删除 ${result.deleted}`);
  } catch (err) {
    console.error('[init] 同步失败:', err.message);
  }

  app.listen(config.port, () => {
    console.log(`[server] 下载站已启动: http://localhost:${config.port}`);
    console.log(`[server] 环境: ${config.nodeEnv}`);
    console.log(`[server] 文件目录: ${config.downloadDir}`);
    console.log(`[server] 数据库: ${config.dbPath}`);
  });
};

// 仅在直接运行时启动服务（允许测试安全导入）
if (require.main === module) {
  startServer();
}

module.exports = app;
