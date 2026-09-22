import { useState, useEffect } from 'react';
import { Shield, LogIn, Eye, EyeOff } from 'lucide-react';

function Login() {
  const [mode, setMode] = useState(null); // 'local' | 'oauth' | null
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/auth/config')
      .then((res) => res.json())
      .then((cfg) => setMode(cfg.localLogin ? 'local' : 'oauth'))
      .catch(() => setMode('oauth'));
  }, []);

  const handleLocalLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/auth/local-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        window.location.href = '/admin';
      } else {
        setError(data.error || '登录失败');
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" data-admin-style="bg">
      <div className="w-full max-w-sm mx-4 p-8 text-center" data-admin-style="panel-modal">
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5" data-admin-style="bg-primary">
          <Shield className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold mb-2" data-admin-style="text">管理后台</h2>

        {mode === 'local' && (
          <>
            <p className="text-sm mb-6" data-admin-style="text-secondary">请输入管理员账号登录</p>
            <form onSubmit={handleLocalLogin} className="space-y-4">
              <input
                type="text"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full px-4 h-11 rounded-lg text-sm outline-none transition-colors"
                data-admin-style="input"
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 pr-11 h-11 rounded-lg text-sm outline-none transition-colors"
                  data-admin-style="input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                  data-admin-style="text-muted"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {error && (
                <p className="text-sm text-left" data-admin-style="text-danger">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full !h-12 flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
            <div className="mt-5 pt-4" data-admin-style="border-top">
              <a
                href="/auth/login?returnUrl=/admin"
                className="text-xs"
                data-admin-style="text-muted"
              >
                使用论坛账号登录 →
              </a>
            </div>
          </>
        )}

        {mode === 'oauth' && (
          <>
            <p className="text-sm mb-8" data-admin-style="text-secondary">使用论坛账号登录以管理下载站</p>
            <a href="/auth/login?returnUrl=/admin" className="btn-primary w-full !h-12">
              通过论坛登录
            </a>
            <p className="text-[11px] mt-6" data-admin-style="text-muted">登录即表示同意论坛服务条款</p>
          </>
        )}

        {!mode && (
          <p className="text-sm mt-4" data-admin-style="text-muted">加载中...</p>
        )}
      </div>
    </div>
  );
}

export default Login;
