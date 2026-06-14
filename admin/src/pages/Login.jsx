import { motion } from 'framer-motion';
import { Sparkles, Shield } from 'lucide-react';
import { DotPattern } from '../components/ui/dot-pattern';
import { GradientText } from '../components/ui/gradient-text';

function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 relative overflow-hidden">
      <DotPattern className="opacity-40" />

      {/* Gradient blobs */}
      <div className="absolute top-20 left-20 w-72 h-72 bg-primary-200 rounded-full blur-3xl opacity-20 animate-pulse-soft" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-200 rounded-full blur-3xl opacity-20 animate-pulse-soft" style={{ animationDelay: '1s' }} />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
        className="relative z-10 w-full max-w-sm mx-4"
      >
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-gray-200/50 shadow-2xl shadow-gray-900/5 p-8 text-center">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-blue-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary-500/30"
          >
            <Shield className="w-8 h-8 text-white" />
          </motion.div>

          <h2 className="text-2xl font-bold mb-2">
            <GradientText>管理后台</GradientText>
          </h2>
          <p className="text-sm text-gray-400 mb-8">
            使用论坛账号登录以管理下载站
          </p>

          <a
            href="/auth/login?returnUrl=/admin"
            className="group relative w-full inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-medium bg-gray-900 text-white overflow-hidden shadow-lg shadow-gray-900/20 hover:bg-gray-800 active:scale-[0.98] transition-all duration-200"
          >
            <Sparkles className="w-4 h-4 mr-2 text-primary-400 group-hover:text-primary-300 transition-colors" />
            通过论坛登录
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          </a>

          <p className="text-[11px] text-gray-300 mt-6">
            登录即表示同意论坛服务条款
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default Login;
