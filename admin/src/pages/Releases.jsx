import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Clock3,
  Edit3,
  Eye,
  ExternalLink,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

const emptyForm = { name: '', owner: '', repo: '', branch: 'main', schedule: '', target_category: '', sync_interval_ms: 21600000, include_prerelease: false, include_draft: false, asset_include_pattern: '', asset_exclude_pattern: '', enabled: true };
const pick = (value, key, fallback = []) => value?.[key] ?? value?.data?.[key] ?? fallback;
const date = (value) => value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function StatusBadge({ status, enabled }) {
  const normalized = String(status || (enabled ? 'healthy' : 'paused')).toLowerCase();
  const healthy = ['healthy', 'success', 'ok', 'completed', 'active'].includes(normalized);
  const pending = ['pending', 'running', 'syncing', 'queued'].includes(normalized);
  return <span className={`badge ${healthy ? 'badge-success' : pending ? 'badge-warning' : 'badge-error'}`} role="status" aria-label={`状态：${healthy ? '健康' : pending ? '同步中' : enabled === false ? '已暂停' : '异常'}`}>{healthy ? '健康' : pending ? '同步中' : enabled === false ? '已暂停' : '异常'}</span>;
}

function Metric({ label, value, tone }) {
  return <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p><p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: tone || 'var(--text)' }}>{value}</p></div>;
}

function SourceModal({ source, saving, onClose, onSave }) {
  const [form, setForm] = useState(source ? { ...emptyForm, ...source } : emptyForm);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); onSave(form); };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="release-source-modal-title" style={{ background: 'rgba(0,0,0,.45)' }} onMouseDown={onClose} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <form className="w-full max-w-lg" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-modal)' }} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}><h3 id="release-source-modal-title" className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{source ? '编辑发布来源' : '添加发布来源'}</h3><button type="button" className="btn-ghost !p-1" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>
      <div className="space-y-4 p-5">
        <div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>来源名称</label><input className="input-field" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：产品主仓库" /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Owner</label><input className="input-field" required value={form.owner} onChange={(e) => set('owner', e.target.value)} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Repo</label><input className="input-field" required value={form.repo} onChange={(e) => set('repo', e.target.value)} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>目标分类</label><input className="input-field" value={form.target_category} onChange={(e) => set('target_category', e.target.value)} placeholder="例如：releases/product" /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>同步间隔（分钟）</label><input className="input-field" type="number" min="5" max="10080" value={Math.round(form.sync_interval_ms / 60000)} onChange={(e) => set('sync_interval_ms', Number(e.target.value || 5) * 60000)} /></div></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>分支</label><input className="input-field" value={form.branch} onChange={(e) => set('branch', e.target.value)} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>同步计划</label><input className="input-field" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} placeholder="例如：每 6 小时" /></div></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>资产包含规则</label><input className="input-field" value={form.asset_include_pattern} onChange={(e) => set('asset_include_pattern', e.target.value)} placeholder="正则，可选" /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>资产排除规则</label><input className="input-field" value={form.asset_exclude_pattern} onChange={(e) => set('asset_exclude_pattern', e.target.value)} placeholder="正则，可选" /></div></div>
        <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />启用自动同步</label>
      </div>
      <div className="flex justify-end gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--border)' }}><button type="button" className="btn-secondary" onClick={onClose}>取消</button><button className="btn-primary" disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{saving ? '保存中...' : '保存来源'}</button></div>
    </form>
  </div>;
}

function DetailPanel({ source, onClose, onRetry, retrying }) {
  const [tab, setTab] = useState('overview');
  const releases = source.preview?.releases || source.releases || source.versions || source.release_versions || [];
  const tasks = source.jobsData?.jobs || source.tasks || source.sync_tasks || source.jobs || [];
  const assets = source.assetsData?.assets || source.assets || [];
  return <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-modal)' }}>
    <div className="flex items-start justify-between border-b p-5" style={{ borderColor: 'var(--border)' }}><div className="min-w-0"><p className="text-xs" style={{ color: 'var(--text-muted)' }}>发布来源详情</p><h2 className="mt-1 truncate text-xl font-bold" style={{ color: 'var(--text)' }}>{source.name || source.title}</h2><a className="mt-1 flex items-center gap-1 truncate text-xs" style={{ color: 'var(--primary)' }} href={source.owner && source.repo ? `${source.owner}/${source.repo}` : source.repository || 'GitHub 来源'} target="_blank" rel="noreferrer">{source.owner && source.repo ? `${source.owner}/${source.repo}` : source.repository || 'GitHub 来源'}<ExternalLink className="h-3 w-3 shrink-0" /></a></div><button className="btn-ghost !p-1.5" onClick={onClose} aria-label="关闭详情"><X className="h-5 w-5" /></button></div>
    <div className="flex border-b px-5" style={{ borderColor: 'var(--border)' }}>{[['overview', '概览'], ['releases', '发布版本'], ['tasks', '同步任务'], ['assets', '资产']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className="border-b-2 px-3 py-3 text-sm font-medium" style={{ color: tab === key ? 'var(--primary)' : 'var(--text-muted)', borderColor: tab === key ? 'var(--primary)' : 'transparent' }} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div className="flex-1 overflow-y-auto p-5">
      {tab === 'overview' && <div className="space-y-5"><div className="grid grid-cols-2 gap-3"><Metric label="当前状态" value={<StatusBadge status={source.status} enabled={source.enabled} />} /><Metric label="已同步版本" value={source.release_count ?? releases.length} /><Metric label="上次同步" value={date(source.last_synced_at || source.last_sync_at)} /><Metric label="下次同步" value={date(source.next_sync_at)} /></div><div className="card !p-4"><h3 className="section-title mb-3">同步信息</h3><dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt style={{ color: 'var(--text-muted)' }}>分支</dt><dd className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{source.branch || 'main'}</dd></div><div><dt style={{ color: 'var(--text-muted)' }}>同步计划</dt><dd className="mt-1 font-medium" style={{ color: 'var(--text)' }}>{source.schedule || '手动同步'}</dd></div><div className="sm:col-span-2"><dt style={{ color: 'var(--text-muted)' }}>最近错误</dt><dd className="mt-1 break-words" style={{ color: source.last_error ? 'var(--error)' : 'var(--text-secondary)' }}>{source.last_error || '暂无错误'}</dd></div></dl></div><button className="btn-secondary w-full" disabled={!source.last_error || retrying} onClick={() => onRetry(source)}><RotateCcw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />{retrying ? '重试中...' : '重试最近失败任务'}</button></div>}
      {tab === 'releases' && <ListState items={releases} icon={GitBranch} empty="暂无发布版本" render={(item) => <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium" style={{ color: 'var(--text)' }}>{item.name || item.tag_name || item.tag || item.version}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{date(item.published_at || item.created_at)}{item.author ? ` · ${item.author}` : ''}</p></div><span className="badge-neutral">{item.status || '已同步'}</span></div>} />}
      {tab === 'tasks' && <ListState items={tasks} icon={Clock3} empty="暂无同步任务" render={(item) => <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium" style={{ color: 'var(--text)' }}>{item.type || '同步任务'}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{date(item.created_at || item.started_at)}</p></div><StatusBadge status={item.status} enabled /></div>} />}
      {tab === 'assets' && <ListState items={assets} icon={Server} empty="暂无同步资产" render={(item) => <div className="flex items-center justify-between gap-3"><span className="truncate text-sm" style={{ color: 'var(--text)' }}>{item.name || item.file_name || item.path}</span><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.size ? `${item.size} bytes` : item.status || ''}</span></div>} />}
    </div>
  </aside>;
}

function ListState({ items, icon: Icon, empty, render }) { return items.length ? <div className="space-y-2">{items.map((item, index) => <div className="card !p-3" key={item.id || item.task_id || index}>{render(item)}</div>)}</div> : <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}><Icon className="mx-auto mb-3 h-10 w-10 opacity-40" /><p className="text-sm">{empty}</p></div>; }

function Releases() {
  const { notify } = useToast();
  const [sources, setSources] = useState([]); const [health, setHealth] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null); const [modal, setModal] = useState(null); const [detail, setDetail] = useState(null); const [busy, setBusy] = useState({}); const [retrying, setRetrying] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const result = await api.getReleases(); setSources(pick(result, 'sources', Array.isArray(result) ? result : [])); setHealth(pick(result, 'health', result.summary || null)); } catch (err) { setError(err); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  const openDetail = async (source) => {
    setDetail({ ...source, loadingDetail: true });
    const id = source.id || source.source_id;
    try {
      const [status, jobsData, assetsData, preview] = await Promise.all([api.getReleaseSourceStatus(id), api.getReleaseSourceJobs(id), api.getReleaseSourceAssets(id), api.previewReleaseSource(id)]);
      setDetail({ ...source, ...status, jobsData, assetsData, preview, loadingDetail: false });
    } catch (err) { notify(`详情加载失败：${err.message}`, 'error'); setDetail({ ...source, loadingDetail: false }); }
  };
  const run = async (id, action, fn, success) => { setBusy((v) => ({ ...v, [`${action}:${id}`]: true })); try { await fn(); notify(success, 'success'); await load(); if (detail?.id === id) setDetail((current) => ({ ...current, ...(sources.find((item) => item.id === id) || {}) })); } catch (err) { notify(`${success.replace('完成', '失败').replace('成功', '失败')}：${err.message}`, 'error'); } finally { setBusy((v) => ({ ...v, [`${action}:${id}`]: false })); } };
  const save = async (form) => { setBusy((v) => ({ ...v, save: true })); try { if (modal.id) await api.updateReleaseSource(modal.id, form); else await api.createReleaseSource(form); notify('发布来源已保存', 'success'); setModal(null); await load(); } catch (err) { notify(`保存失败：${err.message}`, 'error'); } finally { setBusy((v) => ({ ...v, save: false })); } };
  const healthyCount = health?.healthy ?? sources.filter((s) => ['healthy', 'ok', 'active'].includes(String(s.status).toLowerCase())).length;
  const stats = useMemo(() => ({ total: health?.total ?? sources.length, healthy: healthyCount, syncing: health?.syncing ?? sources.filter((s) => ['running', 'syncing', 'pending'].includes(String(s.status).toLowerCase())).length, errors: health?.errors ?? sources.filter((s) => s.last_error || ['error', 'failed', 'unhealthy'].includes(String(s.status).toLowerCase())).length }), [health, sources, healthyCount]);
  if (loading) return <div className="flex h-64 items-center justify-center gap-3" style={{ color: 'var(--text-muted)' }}><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">加载发布来源...</span></div>;
  if (error) return <div className="card flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-10 w-10" style={{ color: 'var(--error)' }} /><p style={{ color: 'var(--text-secondary)' }}>发布来源加载失败：{error.message}</p><button className="btn-secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />重新加载</button></div>;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="page-title">发布同步</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>管理外部发布来源，自动同步版本与发布信息</p></div><div className="flex gap-2"><button className="btn-secondary" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />刷新</button><button className="btn-primary" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />添加来源</button></div></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="来源总数" value={stats.total} /><Metric label="健康来源" value={stats.healthy} tone="var(--success)" /><Metric label="同步中" value={stats.syncing} tone="var(--primary)" /><Metric label="需要关注" value={stats.errors} tone={stats.errors ? 'var(--error)' : 'var(--text)'} /></div>
    {sources.length === 0 ? <div className="card flex flex-col items-center py-16 text-center"><Server className="mb-3 h-12 w-12 opacity-35" style={{ color: 'var(--text-muted)' }} /><p className="font-medium" style={{ color: 'var(--text)' }}>还没有发布来源</p><p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>添加一个 Git 仓库来源，开始同步发布版本。</p><button className="btn-primary mt-5" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />添加第一个来源</button></div> : <div className="card !p-0 overflow-hidden"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>来源</th><th>状态</th><th>最近同步</th><th>版本</th><th className="text-right">操作</th></tr></thead><tbody>{sources.map((source) => { const id = source.id || source.source_id; const isBusy = (action) => busy[`${action}:${id}`]; return <tr key={id}><td><button className="text-left" onClick={() => openDetail(source)}><p className="font-medium" style={{ color: 'var(--text)' }}>{source.name || source.title}</p><p className="mt-0.5 max-w-xs truncate text-xs" style={{ color: 'var(--text-muted)' }}>{source.owner && source.repo ? `${source.owner}/${source.repo}` : source.repository || 'GitHub 来源'}</p></button></td><td><StatusBadge status={source.status} enabled={source.enabled} /></td><td className="whitespace-nowrap text-xs" style={{ color: 'var(--text-muted)' }}>{date(source.last_synced_at || source.last_sync_at)}</td><td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{source.release_count ?? source.version_count ?? 0}</td><td><div className="flex justify-end gap-1"><button className="btn-ghost !p-1.5" title="预览" disabled={isBusy('preview')} onClick={() => run(id, 'preview', () => api.previewReleaseSource(id), '预览已生成')}><Eye className="h-4 w-4" /></button><button className="btn-ghost !p-1.5" title="手动同步" disabled={isBusy('sync')} onClick={() => run(id, 'sync', () => api.syncReleaseSource(id), '同步完成')}><Zap className={`h-4 w-4 ${isBusy('sync') ? 'animate-pulse' : ''}`} /></button><button className="btn-ghost !p-1.5" title={source.enabled === false ? '启用' : '暂停'} onClick={() => run(id, 'toggle', () => api.toggleReleaseSource(id, source.enabled === false), source.enabled === false ? '来源已启用' : '来源已暂停')}>{source.enabled === false ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</button><button className="btn-ghost !p-1.5" title="编辑" onClick={() => setModal(source)}><Edit3 className="h-4 w-4" /></button><button className="btn-ghost !p-1.5" style={{ color: 'var(--error)' }} title="删除" onClick={() => window.confirm(`确认删除来源“${source.name || source.title}”？`) && run(id, 'delete', () => api.deleteReleaseSource(id), '来源已删除')}><Trash2 className="h-4 w-4" /></button><button className="btn-ghost !p-1.5" title="查看详情" onClick={() => openDetail(source)}><ChevronRight className="h-4 w-4" /></button></div></td></tr>; })}</tbody></table></div></div>}
    {modal && <SourceModal source={modal.id ? modal : null} saving={busy.save} onClose={() => setModal(null)} onSave={save} />}{detail && <DetailPanel source={detail} onClose={() => setDetail(null)} retrying={retrying} onRetry={async (source) => { setRetrying(true); try { await api.retryReleaseTask(source.id || source.source_id); notify('重试任务已提交', 'success'); await load(); } catch (err) { notify(`重试失败：${err.message}`, 'error'); } finally { setRetrying(false); } }} />}
  </div>;
}

export default Releases;
