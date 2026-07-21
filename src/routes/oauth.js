const crypto = require('crypto');
const { config } = require('../config');

/**
 * 检查 URL 是否为安全的本地重定向地址
 * 防止开放重定向攻击
 */
const isSafeReturnUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  // 允许以 / 开头的绝对路径
  if (url.startsWith('/')) return true;
  // 允许不含协议的相对路径
  if (!url.includes('://')) return true;
  // 不允许外部 URL
  return false;
};

const startOAuthFlow = (req, res) => {
  // 生成 state 参数防 CSRF
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  // 保存返回地址（验证安全性）
  const returnUrl = isSafeReturnUrl(req.query.returnUrl) ? req.query.returnUrl : '/admin';
  req.session.oauthReturnUrl = returnUrl;

  const params = new URLSearchParams({
    client_id: config.oauth.clientId,
    redirect_uri: config.oauth.callbackUrl,
    response_type: 'code',
    state,
  });

  const authUrl = `${config.oauth.authorizeUrl}?${params.toString()}`;
  return res.redirect(authUrl);
};

const handleCallback = async (req, res) => {
  const { code, state } = req.query;

  // 校验 state
  if (!state || state !== req.session.oauthState) {
    console.error('[oauth] state 不匹配，可能存在 CSRF 攻击');
    return res.status(403).render('error', {
      title: '安全校验失败',
      message: 'OAuth 回调状态验证失败，请重新登录。',
    });
  }

  // 清除 state
  delete req.session.oauthState;

  if (!code) {
    return res.status(400).render('error', {
      title: '授权失败',
      message: '未收到授权码，请重试。',
    });
  }

  // 前置校验 OAuth 配置完整性
  const missingConfig = [];
  if (!config.oauth.tokenUrl) missingConfig.push('OAUTH_TOKEN_URL');
  if (!config.oauth.userinfoUrl) missingConfig.push('OAUTH_USERINFO_URL');
  if (!config.oauth.clientId) missingConfig.push('OAUTH_CLIENT_ID');
  if (!config.oauth.clientSecret) missingConfig.push('OAUTH_CLIENT_SECRET');
  if (!config.oauth.callbackUrl) missingConfig.push('OAUTH_CALLBACK_URL');

  if (missingConfig.length > 0) {
    console.error('[oauth] OAuth 配置缺失:', missingConfig.join(', '));
    return res.status(500).render('error', {
      title: '登录失败',
      message: '服务器 OAuth 配置不完整，请联系管理员。',
    });
  }

  try {
    // 用 code 换取 access_token（10 秒超时）
    const tokenController = new AbortController();
    const tokenTimeout = setTimeout(() => tokenController.abort(), 10_000);

    let tokenResponse;
    try {
      tokenResponse = await fetch(config.oauth.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.oauth.clientId,
          client_secret: config.oauth.clientSecret,
          redirect_uri: config.oauth.callbackUrl,
        }).toString(),
        signal: tokenController.signal,
      });
    } finally {
      clearTimeout(tokenTimeout);
    }

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('[oauth] Token 请求失败:', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        url: config.oauth.tokenUrl,
        body: errorData,
      });
      throw new Error(`获取 Access Token 失败 (HTTP ${tokenResponse.status})`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('[oauth] Token 响应缺少 access_token:', tokenData);
      throw new Error('Token 响应中未包含 access_token');
    }

    // 获取用户信息（10 秒超时）
    const userInfoController = new AbortController();
    const userInfoTimeout = setTimeout(() => userInfoController.abort(), 10_000);

    let userResponse;
    try {
      userResponse = await fetch(config.oauth.userinfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: userInfoController.signal,
      });
    } finally {
      clearTimeout(userInfoTimeout);
    }

    if (!userResponse.ok) {
      const errorData = await userResponse.text();
      console.error('[oauth] 用户信息请求失败:', {
        status: userResponse.status,
        statusText: userResponse.statusText,
        url: config.oauth.userinfoUrl,
        body: errorData,
      });
      throw new Error(`获取用户信息失败 (HTTP ${userResponse.status})`);
    }

    const userData = await userResponse.json();

    // 重新生成 Session ID 防止 Session 固定攻击
    req.session.regenerate((err) => {
      if (err) {
        console.error('[oauth] Session 重新生成失败:', err);
      }

      // 写入用户信息到 Session
      req.session.user = {
        id: userData.id || userData.user_id,
        username: userData.username || userData.name,
        email: userData.email,
      };

      // 跳转回原始页面（验证安全性）
      const returnUrl = isSafeReturnUrl(req.session.oauthReturnUrl)
        ? req.session.oauthReturnUrl
        : '/admin';
      delete req.session.oauthReturnUrl;

      return res.redirect(returnUrl);
    });
  } catch (err) {
    // 区分超时错误与其他错误
    if (err.name === 'AbortError') {
      console.error('[oauth] 请求超时:', err.message);
    } else {
      console.error('[oauth] 认证流程错误:', err.message, err.stack);
    }
    return res.status(500).render('error', {
      title: '登录失败',
      message: 'OAuth 认证过程出错，请稍后重试。',
    });
  }
};

const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[oauth] Session 销毁失败:', err);
    }
    return res.redirect('/');
  });
};

const getMe = (req, res) => {
  // 开发模式：返回测试管理员
  if (process.env.NODE_ENV !== 'production' && !req.session?.user) {
    const { DEV_ADMIN_USER } = require('../middleware/auth');
    req.session.user = { ...DEV_ADMIN_USER };
    return res.json({ user: req.session.user });
  }

  if (!req.session?.user) {
    return res.status(401).json({ error: '未登录' });
  }
  return res.json({ user: req.session.user });
};

/**
 * 返回当前启用的登录方式
 * 论坛未上线时，可通过 ADMIN_USERNAME / ADMIN_PASSWORD 启用本地登录
 */
const getAuthConfig = (req, res) => {
  const localLoginEnabled = !!(config.admin.username && config.admin.password);
  return res.json({
    localLogin: localLoginEnabled,
    oauth: !localLoginEnabled, // 未配置本地登录时走 OAuth
  });
};

/**
 * 本地管理员登录（论坛未上线时的临时方案）
 * 通过 ADMIN_USERNAME / ADMIN_PASSWORD 环境变量控制
 */
const localLogin = (req, res) => {
  const { username, password } = req.body;

  if (!config.admin.username || !config.admin.password) {
    return res.status(403).json({ error: '本地登录未启用' });
  }

  // 使用 timingSafeEqual 防止计时攻击
  const expectedUser = Buffer.from(config.admin.username);
  const actualUser = Buffer.from(username || '');
  const expectedPass = Buffer.from(config.admin.password);
  const actualPass = Buffer.from(password || '');

  const userOk = expectedUser.length === actualUser.length
    && crypto.timingSafeEqual(expectedUser, actualUser);
  const passOk = expectedPass.length === actualPass.length
    && crypto.timingSafeEqual(expectedPass, actualPass);

  if (!userOk || !passOk) {
    console.warn('[oauth] 本地登录失败: 用户名或密码错误');
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  // 重新生成 Session ID 防止 Session 固定攻击
  req.session.regenerate((err) => {
    if (err) {
      console.error('[oauth] Session 重新生成失败:', err);
    }

    req.session.user = {
      id: 1,
      username: config.admin.username,
      email: '',
    };

    return res.json({ ok: true });
  });
};

module.exports = {
  startOAuthFlow,
  handleCallback,
  logout,
  getMe,
  getAuthConfig,
  localLogin,
};
