import { useState, useEffect } from 'react';
import { Settings, Save, Plus, Trash2, RefreshCw, Eye } from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

function SiteSettings() {
  const [siteInfo, setSiteInfo] = useState({ site_name: '', site_description: '', footer_text: '', footer_links: [], icp_number: '', police_number: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const { notify } = useToast();

  const loadSettings = async () => {
    try { setLoading(true); setSiteInfo((await api.getSettings()).siteInfo); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleChange = (field, value) => { setSiteInfo((p) => ({ ...p, [field]: value })); setDirty(true); };
  const handleAddLink = () => { setSiteInfo((p) => ({ ...p, footer_links: [...p.footer_links, { label: '', url: '' }] })); setDirty(true); };
  const handleUpdateLink = (i, field, value) => {
    setSiteInfo((p) => { const links = [...p.footer_links]; links[i] = { ...links[i], [field]: value }; return { ...p, footer_links: links }; });
    setDirty(true);
  };
  const handleRemoveLink = (i) => { setSiteInfo((p) => ({ ...p, footer_links: p.footer_links.filter((_, j) => j !== i) })); setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await api.updateSettings(siteInfo);
      setSiteInfo(result.siteInfo);
      setDirty(false);
      notify('设置已保存', 'success');
    } catch (err) {
      notify(`保存失败：${err.message}`, 'error');
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw className="w-5 h-5 animate-spin" /><span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">站点设置</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>管理网站标题、描述、底部信息等基础内容</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowPreview(!showPreview)} className="btn-secondary">
            <Eye className="w-4 h-4 mr-1.5" />{showPreview ? '隐藏预览' : '预览'}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            <Save className="w-4 h-4 mr-1.5" />{saving ? '保存中...' : '保存更改'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-5">
          <div className="card !p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Settings className="w-4 h-4" style={{ color: 'var(--primary)' }} />基本信息
            </h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="site-name" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>站点名称</label>
                <input id="site-name" type="text" className="input-field" value={siteInfo.site_name} onChange={(e) => handleChange('site_name', e.target.value)} placeholder="例如：文件下载站" />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>显示在页面标题和顶部</p>
              </div>
              <div>
                <label htmlFor="site-description" className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>站点描述</label>
                <input id="site-description" type="text" className="input-field" value={siteInfo.site_description} onChange={(e) => handleChange('site_description', e.target.value)} placeholder="例如：轻量级文件下载服务" />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>显示在页面标题下方（部分主题使用）</p>
              </div>
            </div>
          </div>

          <div className="card !p-5">
            <h3 className="font-semibold mb-4" style={{ color: 'var(--text)' }}>底部信息</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>底部文本</label>
                <input type="text" className="input-field" value={siteInfo.footer_text} onChange={(e) => handleChange('footer_text', e.target.value)} placeholder="例如：Powered by Node.js" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>ICP 备案号</label>
                  <input type="text" className="input-field" value={siteInfo.icp_number} onChange={(e) => handleChange('icp_number', e.target.value)} placeholder="例如：京ICP备12345678号" />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>公安备案号</label>
                  <input type="text" className="input-field" value={siteInfo.police_number} onChange={(e) => handleChange('police_number', e.target.value)} placeholder="例如：京公网安备 11010102000001号" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>底部链接</label>
                  <button onClick={handleAddLink} className="btn-ghost text-xs"><Plus className="w-3 h-3 mr-1" />添加</button>
                </div>
                {siteInfo.footer_links.length === 0 ? (
                  <p className="text-sm italic py-3" style={{ color: 'var(--text-muted)' }}>暂无链接，点击"添加"新增</p>
                ) : (
                  <div className="space-y-2">
                    {siteInfo.footer_links.map((link, i) => (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input type="text" className="input-field flex-1 min-w-0" placeholder="标签" value={link.label} onChange={(e) => handleUpdateLink(i, 'label', e.target.value)} />
                        <input type="text" className="input-field flex-1 min-w-0" placeholder="URL" value={link.url} onChange={(e) => handleUpdateLink(i, 'url', e.target.value)} />
                        <button onClick={() => handleRemoveLink(i)} className="btn-ghost !p-2" style={{ color: 'var(--error)' }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          {showPreview && (
            <div className="sticky top-6">
              <div className="card !p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>实时预览</h3>
                <div className="p-4 mb-3" style={{ border: '1px solid var(--border)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>页头</p>
                  <h4 className="font-bold text-lg" style={{ color: 'var(--text)' }}>{siteInfo.site_name || '站点名称'}</h4>
                  {siteInfo.site_description && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{siteInfo.site_description}</p>}
                </div>
                <div className="p-4" style={{ border: '1px solid var(--border)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>页脚</p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{siteInfo.footer_text || '底部文本'}</p>
                    <div className="flex gap-3">
                      {siteInfo.footer_links.map((link, i) => (
                        <span key={i} className="text-xs cursor-pointer" style={{ color: 'var(--primary)' }}>{link.label || '(未命名)'}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteSettings;
