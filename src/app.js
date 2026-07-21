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
const { attachUser } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// 服务初始化
const { syncDirectory } = require('./services/sync.service');

const app = express();

// ===== 基础中间件 =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
  saveUninitialized: false,
  cookie: {
    maxAge: config.session.maxAge,
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
  },
}));

// ===== 静态资源 =====
app.use(express.static(path.join(__dirname, '..', 'public')));

// 后台 React SPA
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.get('/admin/*', (req, res) => {
  const adminIndex = path.join(__dirname, '..', 'public', 'admin', 'index.html');
  if (fs.existsSync(adminIndex)) {
    return res.sendFile(adminIndex);
  }
  // 如果 React 未构建，返回提示
  return res.status(404).render('error', {
    title: '后台未构建',
    message: '请先运行 npm run build:admin 构建后台前端。',
  });
});

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

  // 校验配置
  validateConfig();

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
