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

  try {
    // 用 code 换取 access_token
    const tokenResponse = await fetch(config.oauth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
        redirect_uri: config.oauth.callbackUrl,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('[oauth] Token 请求失败:', errorData);
      throw new Error('获取 Access Token 失败');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 获取用户信息
    const userResponse = await fetch(config.oauth.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      throw new Error('获取用户信息失败');
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
      const returnUrl = isSafeReturnUrl(req.session.oauthReturnUrl) ? req.session.oauthReturnUrl : '/admin';
      delete req.session.oauthReturnUrl;

      return res.redirect(returnUrl);
    });
  } catch (err) {
    console.error('[oauth] 认证流程错误:', err.message);
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

module.exports = {
  startOAuthFlow,
  handleCallback,
  logout,
  getMe,
};
