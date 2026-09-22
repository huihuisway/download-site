import { useState, useEffect } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

const themeDescs = {
  editorial: '侧边栏导航，粗体标题，蓝色分隔线。杂志风格，适合文艺站点。',
  cloud: '水平标签栏，卡片文件展示，彩色文件类型图标。网盘风格，适合国内用户。',
  mirror: '紧凑表格，等宽数字，面包屑导航。镜像站风格，适合技术用户。',
  terminal: '默认暗色，全等宽字体，终端提示符风格。极客美学，适合技术社区。',
};

function ThemeSettings() {
  const [currentTheme, setCurrentTheme] = useState('editorial');
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const { notify } = useToast();

  const loadTheme = async () => {
    try {
      setLoading(true);
      const data = await api.getTheme();
      setCurrentTheme(data.currentTheme);
      setThemes(data.themes);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadTheme(); }, []);

  const handleSelect = async (themeId) => {
    if (themeId === currentTheme) return;
    setSaving(themeId);
    try { await api.setTheme(themeId); setCurrentTheme(themeId); }
    catch (err) { notify(`切换失败：${err.message}`, 'error'); }
    finally { setSaving(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3" data-admin-style="text-muted">
          <RefreshCw className="w-5 h-5 animate-spin" /><span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="page-title">主题设置</h2>
        <p className="text-sm mt-1" data-admin-style="text-secondary">选择前台页面的显示主题。更改后立即生效。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {themes.map((theme) => {
          const isActive = theme.id === currentTheme;
          const isSaving = saving === theme.id;

          return (
            <button
              type="button"
              key={theme.id}
              className="card relative !p-0 cursor-pointer text-left transition-colors"
              aria-pressed={isActive}
              aria-label={`${theme.name}${isActive ? '（当前主题）' : ''}`}
              onClick={() => handleSelect(theme.id)}
            >
              {/* Preview strip */}
              <div className="admin-theme-preview h-20 flex items-center justify-center" data-terminal={theme.id === 'terminal'}>
                <span className="text-xs font-mono tracking-widest uppercase">
                  {theme.id === 'editorial' ? 'Serif' : theme.id === 'cloud' ? 'Card' : theme.id === 'mirror' ? 'Mono' : 'Dark'}
                </span>
                {isActive && (
                  <div className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center" data-admin-style="bg-primary">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold" data-admin-style="text">{theme.name}</h3>
                  {isActive && <span className="badge-success !text-[10px]">当前</span>}
                </div>
                <p className="text-xs leading-relaxed" data-admin-style="text-secondary">
                  {themeDescs[theme.id] || theme.description}
                </p>
                {isSaving && (
                  <div className="flex items-center gap-2 mt-3 text-xs" data-admin-style="text-primary">
                    <RefreshCw className="w-3 h-3 animate-spin" /> 切换中...
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeSettings;
