import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Files,
  FolderTree,
  Palette,
  Settings,
  LogOut,
  ArrowLeft,
  Sun,
  Moon,
  Key,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  });

  const toggle = () => {
    const html = document.documentElement;
    html.classList.add('theme-transitioning');

    const next = !dark;
    setDark(next);

    if (next) {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', next ? 'dark' : 'light');

    setTimeout(() => html.classList.remove('theme-transitioning'), 400);
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-3 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--muted)] transition-colors duration-150 w-full"
      aria-label="切换主题"
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {dark ? '浅色模式' : '深色模式'}
    </button>
  );
}

function Layout({ user, children }) {
  const isDev = user?.isDev === true;
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = [
    { to: '/', label: '统计看板', icon: LayoutDashboard, end: true },
    { to: '/files', label: '文件管理', icon: Files },
    { to: '/categories', label: '目录管理', icon: FolderTree },
    { to: '/theme', label: '主题设置', icon: Palette },
    { to: '/settings', label: '站点设置', icon: Settings },
    { to: '/api-keys', label: 'API Key', icon: Key },
  ];

  const currentPage = navItems.find(
    (item) => item.end
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to) && item.to !== '/'
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Dev Banner */}
      {isDev && (
        <div className="text-center py-1.5 text-xs font-semibold" style={{ background: 'rgba(255,193,7,0.18)', color: '#f59e0b' }}>
          开发模式 — 测试账户 dev-admin，无需 OAuth 登录
        </div>
      )}

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-[min(84vw,280px)] flex flex-col transform transition-transform duration-200 md:static md:w-[200px] md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
          style={{ background: 'var(--card)', borderRight: '1px solid var(--border)' }}
        >
          {/* Logo */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 flex items-center justify-center"
                style={{ background: 'var(--primary)' }}
              >
                <span className="text-white font-bold text-sm">D</span>
              </div>
              <div>
                <h1 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>下载站管理</h1>
                <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  {user?.username || '管理员'}
                  {isDev && (
                    <span className="badge-info !py-0 !px-1.5 !text-[10px]">dev</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                      isActive ? 'font-semibold' : ''
                    }`
                  }
                  style={({ isActive }) => ({
                    borderLeft: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                    background: isActive ? 'var(--muted)' : 'transparent',
                    color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  })}
                >
                  {() => (
                    <>
                      <Icon className="w-4 h-4" />
                      {item.label}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="p-3 space-y-0.5" style={{ borderTop: '1px solid var(--border-light)' }}>
            <ThemeToggle />
            <a
              href="/"
              className="flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--muted)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <ArrowLeft className="w-4 h-4" />
              返回前台
            </a>
            <a
              href="/auth/logout"
              className="flex items-center gap-3 px-3 py-2 text-sm transition-colors duration-150"
              style={{ color: 'var(--error)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--error-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </a>
          </div>
        </aside>

        {mobileNavOpen && (
          <button
            type="button"
            aria-label="关闭导航菜单"
            className="fixed inset-0 z-30 bg-slate-950/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <div
            className="h-14 flex items-center gap-3 px-4 md:px-6"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--card)' }}
          >
            <button
              type="button"
              className="btn-ghost !p-2 md:hidden"
              aria-label={mobileNavOpen ? '关闭导航菜单' : '打开导航菜单'}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h2 className="text-page font-semibold min-w-0 truncate" style={{ color: 'var(--text)' }}>
              {currentPage?.label || '管理后台'}
            </h2>
          </div>

          <main className="flex-1 p-4 md:p-6 overflow-auto min-w-0" style={{ background: 'var(--bg)' }}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export default Layout;
