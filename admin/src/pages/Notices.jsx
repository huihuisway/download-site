import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, Edit3, Eye, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

const emptyForm = {
  title: '', content: '', type: 'info', category: 'announcement', scope: 'global', platform: 'all',
  version: '', priority: 50, dismissible: true, start_at: '', end_at: '', action_label: '', action_url: '', enabled: true,
};

const date = (value) => (value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '—');
// datetime-local 需要 `YYYY-MM-DDTHH:mm`；后端存的是 ISO，做一次双向转换
const toLocalInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_LABEL = (notice) => {
  if (notice.enabled === false) return { label: '已停用', cls: 'badge-neutral' };
  const now = Date.now();
  if (notice.start_at && Date.parse(notice.start_at) > now) return { label: '待发布', cls: 'badge-info' };
  if (notice.end_at && Date.parse(notice.end_at) < now) return { label: '已结束', cls: 'badge-neutral' };
  return { label: '展示中', cls: 'badge-success' };
};

function NoticeModal({ notice, meta, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => {
    if (!notice) return emptyForm;
    return {
      ...emptyForm,
      ...notice,
      start_at: toLocalInput(notice.start_at),
      end_at: toLocalInput(notice.end_at),
    };
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    // 空字符串交给后端存 null，避免把 '' 当成合法时间
    onSave({
      ...form,
      start_at: form.start_at ? new Date(form.start_at).toISOString() : null,
      end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="notice-modal-title" data-admin-style="overlay" onMouseDown={onClose}>
      <form className="w-full max-w-2xl my-8" data-admin-style="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" data-admin-style="border">
          <h3 id="notice-modal-title" className="text-lg font-semibold" data-admin-style="text">{notice ? '编辑通知' : '新建通知'}</h3>
          <button type="button" className="btn-ghost !p-1" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="notice-title" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">标题</label>
            <input id="notice-title" className="input-field" required maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：Mindustry Build 151 已同步完成" />
          </div>
          <div>
            <label htmlFor="notice-content" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">正文</label>
            <textarea id="notice-content" className="input-field" rows={4} maxLength={2000} value={form.content} onChange={(e) => set('content', e.target.value)} placeholder="Android 社区构建正在同步，预计稍后可用，Windows 和 Linux 不受影响。" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="notice-type" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">类型</label>
              <select id="notice-type" className="input-field" value={form.type} onChange={(e) => set('type', e.target.value)}>
                {(meta.types || []).map((type) => <option key={type} value={type}>{meta.typeLabels?.[type] || type}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="notice-category" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">分类</label>
              <select id="notice-category" className="input-field" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {(meta.categories || []).map((key) => <option key={key} value={key}>{meta.categoryLabels?.[key] || key}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="notice-scope" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">目标位置</label>
              <select id="notice-scope" className="input-field" value={form.scope} onChange={(e) => set('scope', e.target.value)}>
                {(meta.scopes || []).map((scope) => <option key={scope} value={scope}>{scope === 'global' ? '全站横幅' : `页面：${scope}`}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="notice-platform" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">目标平台</label>
              <select id="notice-platform" className="input-field" value={form.platform} onChange={(e) => set('platform', e.target.value)}>
                {(meta.platforms || []).map((platform) => <option key={platform} value={platform}>{platform === 'all' ? '全部平台' : platform}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="notice-version" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">关联版本</label>
              <input id="notice-version" className="input-field" value={form.version} onChange={(e) => set('version', e.target.value)} placeholder="v151（可选）" />
            </div>
            <div>
              <label htmlFor="notice-priority" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">优先级（0-100）</label>
              <input id="notice-priority" type="number" min="0" max="100" className="input-field" value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="notice-start" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">生效时间（定时发布）</label>
              <input id="notice-start" type="datetime-local" className="input-field" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} />
            </div>
            <div>
              <label htmlFor="notice-end" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">失效时间（定时结束）</label>
              <input id="notice-end" type="datetime-local" className="input-field" value={form.end_at} onChange={(e) => set('end_at', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="notice-action-label" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">按钮文案</label>
              <input id="notice-action-label" className="input-field" maxLength={40} value={form.action_label} onChange={(e) => set('action_label', e.target.value)} placeholder="查看详情（可选）" />
            </div>
            <div>
              <label htmlFor="notice-action-url" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">按钮链接</label>
              <input id="notice-action-url" className="input-field" value={form.action_url} onChange={(e) => set('action_url', e.target.value)} placeholder="/mindustry 或 https://…（可选）" />
            </div>
          </div>
          <div className="flex flex-wrap gap-5 text-sm" data-admin-style="text-secondary">
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />启用</label>
            <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.dismissible} onChange={(e) => set('dismissible', e.target.checked)} />允许访客关闭</label>
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-4" data-admin-style="border">
          <p className="text-xs" data-admin-style="text-muted">系统通知（同步异常等）由项目同步自动生成，与此处人工通知分开展示。</p>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
            <button className="btn-primary" disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{saving ? '保存中...' : '保存通知'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function NoticePreview({ notice }) {
  return (
    <div className="mdt-banner" data-type={notice.type} style={{ display: 'flex' }}>
      <span className="mdt-banner-icon" aria-hidden="true">{notice.type === 'critical' ? '!' : notice.type === 'warning' || notice.type === 'maintenance' ? '△' : 'i'}</span>
      <span className="mdt-banner-body">
        <strong>{notice.title}</strong>{notice.content ? ` — ${notice.content}` : ''}
        {notice.action_label ? <a href={notice.action_url || '#'}>{notice.action_label}</a> : null}
      </span>
    </div>
  );
}

function Notices() {
  const { notify } = useToast();
  const [notices, setNotices] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getNotices();
      setNotices(result.notices || []);
      setMeta(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    setSaving(true);
    try {
      if (modal?.id) await api.updateNotice(modal.id, form);
      else await api.createNotice(form);
      notify('通知已保存', 'success');
      setModal(null);
      await load();
    } catch (err) {
      notify(`保存失败：${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const run = async (id, action, fn, message) => {
    setBusy((v) => ({ ...v, [`${action}:${id}`]: true }));
    try {
      await fn();
      notify(message, 'success');
      await load();
    } catch (err) {
      notify(`${message}失败：${err.message}`, 'error');
    } finally {
      setBusy((v) => ({ ...v, [`${action}:${id}`]: false }));
    }
  };

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      total: notices.length,
      active: notices.filter((n) => n.enabled !== false && (!n.start_at || Date.parse(n.start_at) <= now) && (!n.end_at || Date.parse(n.end_at) >= now)).length,
      scheduled: notices.filter((n) => n.start_at && Date.parse(n.start_at) > now).length,
      system: notices.filter((n) => n.source === 'system').length,
    };
  }, [notices]);

  if (loading) return <div className="flex h-64 items-center justify-center gap-3" data-admin-style="text-muted"><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">加载通知...</span></div>;
  if (error) return <div className="card flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-10 w-10" data-admin-style="text-error" /><p data-admin-style="text-secondary">通知加载失败：{error.message}</p><button className="btn-secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />重新加载</button></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="page-title">通知管理</h2>
          <p className="mt-1 text-sm" data-admin-style="text-secondary">管理全站公告、维护通知与同步提示</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />刷新</button>
          <button className="btn-primary" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />新建通知</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">通知总数</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text">{stats.total}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">展示中</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text-success">{stats.active}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">待发布</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text-primary">{stats.scheduled}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">系统通知</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text">{stats.system}</p></div>
      </div>

      {notices.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <Bell className="mb-3 h-12 w-12 opacity-35" data-admin-style="text-muted" />
          <p className="font-medium" data-admin-style="text">还没有通知</p>
          <p className="mt-1 text-sm" data-admin-style="text-muted">发布一条公告，访客会在站内横幅与通知中心看到它。</p>
          <button className="btn-primary mt-5" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />新建第一条通知</button>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>标题</th><th>类型</th><th>目标范围</th><th>状态</th><th>生效时间</th><th>失效时间</th><th className="text-right">操作</th></tr>
              </thead>
              <tbody>
                {notices.map((notice) => {
                  const state = STATUS_LABEL(notice);
                  return (
                    <tr key={notice.id}>
                      <td>
                        <p className="font-medium" data-admin-style="text">{notice.title}</p>
                        <p className="mt-0.5 max-w-sm truncate text-xs" data-admin-style="text-muted">
                          {notice.source === 'system' ? '系统通知' : '人工通知'} · {notice.category_label} · P{notice.priority}
                        </p>
                      </td>
                      <td><span className={`badge ${notice.type === 'critical' ? 'badge-error' : notice.type === 'warning' ? 'badge-warning' : notice.type === 'success' ? 'badge-success' : 'badge-info'}`}>{notice.type_label}</span></td>
                      <td className="text-xs" data-admin-style="text-secondary">{notice.scope === 'global' ? '全站横幅' : notice.scope} · {notice.platform}</td>
                      <td><span className={`badge ${state.cls}`}>{state.label}</span></td>
                      <td className="whitespace-nowrap text-xs" data-admin-style="text-muted">{date(notice.start_at || notice.created_at)}</td>
                      <td className="whitespace-nowrap text-xs" data-admin-style="text-muted">{date(notice.end_at)}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button className="btn-ghost !p-1.5" title="预览" onClick={() => setPreview(notice)}><Eye className="h-4 w-4" /></button>
                          <button className="btn-ghost !p-1.5" title="编辑" onClick={() => setModal(notice)}><Edit3 className="h-4 w-4" /></button>
                          <button
                            className="btn-ghost !p-1.5"
                            title={notice.enabled === false ? '启用' : '停用'}
                            disabled={busy[`toggle:${notice.id}`]}
                            onClick={() => run(notice.id, 'toggle', () => (notice.enabled === false ? api.enableNotice(notice.id) : api.disableNotice(notice.id)), notice.enabled === false ? '通知已启用' : '通知已停用')}
                          >
                            {notice.enabled === false ? '启用' : '停用'}
                          </button>
                          <button
                            className="btn-ghost !p-1.5"
                            data-admin-style="text-error"
                            title="删除"
                            onClick={() => window.confirm(`确认删除通知“${notice.title}”？`) && run(notice.id, 'delete', () => api.deleteNotice(notice.id), '通知已删除')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && <NoticeModal notice={modal.id ? modal : null} meta={meta} saving={saving} onClose={() => setModal(null)} onSave={save} />}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="通知预览" data-admin-style="overlay" onMouseDown={() => setPreview(null)}>
          <div className="w-full max-w-xl" data-admin-style="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-5 py-4" data-admin-style="border">
              <h3 className="text-lg font-semibold" data-admin-style="text">前台预览</h3>
              <button type="button" className="btn-ghost !p-1" onClick={() => setPreview(null)} aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5"><NoticePreview notice={preview} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Notices;
