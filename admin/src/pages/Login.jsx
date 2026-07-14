import { Shield } from 'lucide-react';

function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm mx-4 p-8 text-center" style={{ background: 'var(--card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}>
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-5" style={{ background: 'var(--primary)' }}>
          <Shield className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>管理后台</h2>
        <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>使用论坛账号登录以管理下载站</p>
        <a href="/auth/login?returnUrl=/admin" className="btn-primary w-full !h-12">
          通过论坛登录
        </a>
        <p className="text-[11px] mt-6" style={{ color: 'var(--text-muted)' }}>登录即表示同意论坛服务条款</p>
      </div>
    </div>
  );
}

export default Login;
