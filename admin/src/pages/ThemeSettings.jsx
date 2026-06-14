import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Palette, Check, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { AnimatedCard } from '../components/ui/animated-card';
import { GradientText } from '../components/ui/gradient-text';
import { ShineButton } from '../components/ui/shine-button';

const themePreviews = {
  editorial: {
    gradient: 'from-gray-900 to-gray-700',
    bg: 'bg-white',
    label: 'Serif',
    desc: 'Noto Serif SC 衬线标题，纯黑白配色，左侧分类导航，三行堆叠文件条目，整行可点击下载。适合追求文艺质感的站点。',
  },
  cloud: {
    gradient: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50',
    label: 'Card',
    desc: '圆角卡片 + 分类标签页 + 彩色文件图标 + 蓝色下载按钮。类似百度云盘/阿里云盘的熟悉体验，适合国内用户。',
  },
  mirror: {
    gradient: 'from-gray-500 to-gray-600',
    bg: 'bg-gray-50',
    label: 'Mono',
    desc: 'JetBrains Mono 等宽字体，紧凑表格，无多余装饰，Apache/Nginx 目录列表风格。适合技术用户和镜像站。',
  },
  terminal: {
    gradient: 'from-emerald-500 to-cyan-500',
    bg: 'bg-gray-900',
    label: 'Dark',
    desc: '深色 Tokyo Night 配色，等宽字体，终端提示符风格，绿色/黄色/青色点缀。极客美学，适合技术社区。',
  },
};

function ThemeSettings() {
  const [currentTheme, setCurrentTheme] = useState('editorial');
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  const loadTheme = async () => {
    try {
      setLoading(true);
      const data = await api.getTheme();
      setCurrentTheme(data.currentTheme);
      setThemes(data.themes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTheme(); }, []);

  const handleSelect = async (themeId) => {
    if (themeId === currentTheme) return;
    setSaving(themeId);
    try {
      await api.setTheme(themeId);
      setCurrentTheme(themeId);
    } catch (err) {
      alert(`切换失败: ${err.message}`);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold"><GradientText>主题设置</GradientText></h2>
        <p className="text-sm text-gray-400 mt-1">选择前台页面的显示主题。更改后立即生效。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {themes.map((theme, i) => {
          const preview = themePreviews[theme.id] || {};
          const isActive = theme.id === currentTheme;
          const isSaving = saving === theme.id;

          return (
            <motion.div
              key={theme.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`relative rounded-2xl border-2 transition-all duration-200 overflow-hidden cursor-pointer ${
                isActive
                  ? 'border-primary-500 shadow-lg shadow-primary-500/10'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => handleSelect(theme.id)}
            >
              {/* Preview strip */}
              <div className={`h-24 bg-gradient-to-br ${preview.gradient} relative flex items-center justify-center`}>
                <span className="text-white/80 text-xs font-mono tracking-widest uppercase">{preview.label}</span>
                {isActive && (
                  <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow">
                    <Check className="w-4 h-4 text-primary-600" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-5 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-gray-900">{theme.name}</h3>
                  {isActive && (
                    <span className="badge-green !text-[10px]">当前</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{preview.desc || theme.description}</p>
                {isSaving && (
                  <div className="flex items-center gap-2 mt-3 text-xs text-primary-600">
                    <RefreshCw className="w-3 h-3 animate-spin" /> 切换中...
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeSettings;
