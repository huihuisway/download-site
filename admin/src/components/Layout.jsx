import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Files,
  FolderTree,
  Palette,
  Settings,
  LogOut,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';

function Layout({ user, children }) {
  const isDev = user?.isDev === true;
  const location = useLocation();

  const navItems = [
    { to: '/', label: '统计看板', icon: LayoutDashboard, end: true },
    { to: '/files', label: '文件管理', icon: Files },
    { to: '/categories', label: '目录管理', icon: FolderTree },
    { to: '/theme', label: '主题设置', icon: Palette },
    { to: '/settings', label: '站点设置', icon: Settings },
  ];

  const currentPage = navItems.find(
    (item) => item.end
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to) && item.to !== '/'
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Dev Banner */}
      {isDev && (
        <div className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 text-black text-xs text-center py-1.5 font-semibold tracking-wide">
          <Sparkles className="inline w-3 h-3 mr-1 -mt-0.5" />
          开发模式 — 测试账户 dev-admin，无需 OAuth 登录
          <Sparkles className="inline w-3 h-3 ml-1 -mt-0.5" />
        </div>
      )}

      <div className="flex flex-1">
        {/* Sidebar */}
        <motion.aside
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-60 bg-white border-r border-gray-200/80 flex flex-col"
        >
          {/* Logo */}
          <div className="p-5 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-blue-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
                <span className="text-white font-bold text-sm">D</span>
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-900">下载站管理</h1>
                <p className="text-[11px] text-gray-400 flex items-center gap-1">
                  {user?.username || '管理员'}
                  {isDev && (
                    <span className="badge-blue !py-0 !px-1.5 !text-[10px]">dev</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/10'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`w-4 h-4 ${isActive ? 'text-primary-400' : ''}`} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          {/* Bottom Actions */}
          <div className="p-3 border-t border-gray-100 space-y-1">
            <a
              href="/"
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              返回前台
            </a>
            <a
              href="/auth/logout"
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-red-400 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </a>
          </div>
        </motion.aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <div className="h-14 border-b border-gray-100 bg-white/80 backdrop-blur-sm flex items-center px-6">
            <h2 className="text-sm font-semibold text-gray-900">
              {currentPage?.label || '管理后台'}
            </h2>
          </div>

          <main className="flex-1 p-6 overflow-auto">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default Layout;
