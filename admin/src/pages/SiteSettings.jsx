import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, Save, Plus, Trash2, RefreshCw, Eye } from 'lucide-react';
import api from '../api/client';
import { AnimatedCard } from '../components/ui/animated-card';
import { GradientText } from '../components/ui/gradient-text';
import { ShineButton } from '../components/ui/shine-button';

function SiteSettings() {
  const [siteInfo, setSiteInfo] = useState({
    site_name: '',
    site_description: '',
    footer_text: '',
    footer_links: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await api.getSettings();
      setSiteInfo(data.siteInfo);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleChange = (field, value) => {
    setSiteInfo((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  };

  const handleAddLink = () => {
    setSiteInfo((prev) => ({
      ...prev,
      footer_links: [...prev.footer_links, { label: '', url: '' }],
    }));
    setDirty(true);
  };

  const handleUpdateLink = (index, field, value) => {
    setSiteInfo((prev) => {
      const links = [...prev.footer_links];
      links[index] = { ...links[index], [field]: value };
      return { ...prev, footer_links: links };
    });
    setDirty(true);
  };

  const handleRemoveLink = (index) => {
    setSiteInfo((prev) => ({
      ...prev,
      footer_links: prev.footer_links.filter((_, i) => i !== index),
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await api.updateSettings(siteInfo);
      setSiteInfo(result.siteInfo);
      setDirty(false);
    } catch (err) {
      alert(`保存失败: ${err.message}`);
    } finally {
      setSaving(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold"><GradientText>站点设置</GradientText></h2>
          <p className="text-sm text-gray-400 mt-1">管理网站标题、描述、底部信息等基础内容</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="btn-secondary"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            {showPreview ? '隐藏预览' : '预览'}
          </button>
          <ShineButton onClick={handleSave} disabled={saving || !dirty}>
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? '保存中...' : '保存更改'}
          </ShineButton>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-3 space-y-5">
          <AnimatedCard delay={0.1}>
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary-500" />
              基本信息
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  站点名称
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={siteInfo.site_name}
                  onChange={(e) => handleChange('site_name', e.target.value)}
                  placeholder="例如：文件下载站"
                />
                <p className="text-xs text-gray-400 mt-1">显示在页面标题和顶部</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  站点描述
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={siteInfo.site_description}
                  onChange={(e) => handleChange('site_description', e.target.value)}
                  placeholder="例如：轻量级文件下载服务"
                />
                <p className="text-xs text-gray-400 mt-1">显示在页面标题下方（部分主题使用）</p>
              </div>
            </div>
          </AnimatedCard>

          <AnimatedCard delay={0.2}>
            <h3 className="font-semibold text-gray-900 mb-4">底部信息</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  底部文本
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={siteInfo.footer_text}
                  onChange={(e) => handleChange('footer_text', e.target.value)}
                  placeholder="例如：Powered by Node.js"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    底部链接
                  </label>
                  <button onClick={handleAddLink} className="btn-ghost text-xs">
                    <Plus className="w-3 h-3 mr-1" />添加
                  </button>
                </div>
                {siteInfo.footer_links.length === 0 ? (
                  <p className="text-sm text-gray-400 italic py-3">暂无链接，点击"添加"新增</p>
                ) : (
                  <div className="space-y-2">
                    {siteInfo.footer_links.map((link, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex gap-2 items-center"
                      >
                        <input
                          type="text"
                          className="input-field flex-1"
                          placeholder="标签"
                          value={link.label}
                          onChange={(e) => handleUpdateLink(i, 'label', e.target.value)}
                        />
                        <input
                          type="text"
                          className="input-field flex-1"
                          placeholder="URL（如 /admin 或 https://...）"
                          value={link.url}
                          onChange={(e) => handleUpdateLink(i, 'url', e.target.value)}
                        />
                        <button
                          onClick={() => handleRemoveLink(i)}
                          className="btn-ghost !p-2 !text-red-400 hover:!text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </AnimatedCard>
        </div>

        {/* Preview */}
        <div className="lg:col-span-2">
          {showPreview && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="sticky top-6"
            >
              <AnimatedCard delay={0.3}>
                <h3 className="font-semibold text-gray-900 mb-4 text-sm uppercase tracking-wider text-gray-500">
                  实时预览
                </h3>
                {/* Header preview */}
                <div className="border border-gray-200 rounded-xl p-4 mb-3">
                  <p className="text-xs text-gray-400 mb-2">页头</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <h4 className="font-bold text-lg text-gray-900" style={{ fontFamily: 'Georgia, serif' }}>
                        {siteInfo.site_name || '站点名称'}
                      </h4>
                      {siteInfo.site_description && (
                        <p className="text-xs text-gray-400 mt-1">{siteInfo.site_description}</p>
                      )}
                    </div>
                  </div>
                </div>
                {/* Footer preview */}
                <div className="border border-gray-200 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-2">页脚</p>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{siteInfo.footer_text || '底部文本'}</p>
                    <div className="flex gap-3">
                      {siteInfo.footer_links.map((link, i) => (
                        <span key={i} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer">
                          {link.label || '(未命名)'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </AnimatedCard>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteSettings;
