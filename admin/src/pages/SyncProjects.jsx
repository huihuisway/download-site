import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, GitBranch, Loader2, Plus, RefreshCw, Trash2, X, Zap } from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

const date = (value) => (value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const STATUS_CLASS = {
  synced: 'badge-success',
  syncing: 'badge-info',
  pending: 'badge-neutral',
  partial: 'badge-warning',
  delayed: 'badge-warning',
  failed: 'badge-error',
  unknown: 'badge-neutral',
};

const NOTIFY_FIELDS = [
  ['new_version', '发现新版本'],
  ['sync_complete', '同步完成'],
  ['delayed', '同步延迟'],
  ['failed', '同步失败'],
  ['recovered', '恢复正常'],
];

const emptyForm = {
  name: '', slug: '', description: '', icon: '', enabled: true, public_visible: true, affects_global_status: true,
  source_type: 'github_release', source_id: '', local_path: '', file_pattern: '', file_exclude_pattern: '',
  expected_assets: '', check_interval_minutes: 60, timeout_ms: 30000, depends_on: [],
  notify: { new_version: false, sync_complete: false, delayed: true, failed: true, recovered: true },
};

const toForm = (project, sources) => ({
  ...emptyForm,
  ...project,
  source_id: project.source_id ?? '',
  expected_assets: (project.expected_assets || []).join('\n'),
  check_interval_minutes: Math.round((project.check_interval_ms || 3600000) / 60000),
  depends_on: project.depends_on || [],
  notify: { ...emptyForm.notify, ...(project.notify || {}) },
  sources,
});

const toPayload = (form) => ({
  name: form.name,
  slug: form.slug,
  description: form.description,
  icon: form.icon,
  enabled: form.enabled,
  public_visible: form.public_visible,
  affects_global_status: form.affects_global_status,
  source_type: form.source_type,
  source_id: form.source_id === '' ? null : Number(form.source_id),
  local_path: form.local_path,
  file_pattern: form.file_pattern,
  file_exclude_pattern: form.file_exclude_pattern,
  expected_assets: String(form.expected_assets || '').split('\n').map((line) => line.trim()).filter(Boolean),
  check_interval_ms: Number(form.check_interval_minutes) * 60000,
  timeout_ms: Number(form.timeout_ms),
  depends_on: form.depends_on,
  notify: form.notify,
});

function ProjectModal({ project, projects, sources, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => toForm(project || {}, sources));
  const [tab, setTab] = useState('basic');
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setNotify = (key, value) => setForm((current) => ({ ...current, notify: { ...current.notify, [key]: value } }));
  const submit = (event) => { event.preventDefault(); onSave(toPayload(form)); };

  const tabs = [['basic', '基本设置'], ['sync', '同步设置'], ['files', '文件匹配'], ['deps', '依赖关系'], ['notify', '通知设置']];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby="sync-project-modal-title" data-admin-style="overlay" onMouseDown={onClose}>
      <form className="my-8 w-full max-w-2xl" data-admin-style="modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4" data-admin-style="border">
          <h3 id="sync-project-modal-title" className="text-lg font-semibold" data-admin-style="text">{project?.id ? '编辑项目' : '新建同步项目'}</h3>
          <button type="button" className="btn-ghost !p-1" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-wrap border-b px-5" data-admin-style="border">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" className="border-b-2 px-3 py-3 text-sm font-medium" style={{ borderColor: tab === key ? 'var(--primary)' : 'transparent', color: tab === key ? 'var(--primary)' : 'var(--text-secondary)' }} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {tab === 'basic' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label htmlFor="project-name" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">项目名称</label><input id="project-name" className="input-field" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：Mindustry Android" /></div>
                <div><label htmlFor="project-slug" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">项目标识</label><input id="project-slug" className="input-field" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="mindustry-android" /></div>
              </div>
              <div><label htmlFor="project-desc" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">描述</label><input id="project-desc" className="input-field" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="一句话说明这个项目同步什么" /></div>
              <div className="flex flex-wrap gap-5 text-sm" data-admin-style="text-secondary">
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />启用</label>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.public_visible} onChange={(e) => set('public_visible', e.target.checked)} />前台可见</label>
                <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={form.affects_global_status} onChange={(e) => set('affects_global_status', e.target.checked)} />影响总体状态</label>
              </div>
            </>
          )}

          {tab === 'sync' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="project-source-type" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">来源类型</label>
                  <select id="project-source-type" className="input-field" value={form.source_type} onChange={(e) => set('source_type', e.target.value)}>
                    <option value="github_release">GitHub Release</option>
                    <option value="github_actions">GitHub Actions</option>
                    <option value="http_json">HTTP JSON</option>
                    <option value="manifest">Manifest</option>
                    <option value="remote_file">远端文件</option>
                    <option value="local_directory">本地目录</option>
                    <option value="custom_http">自定义 HTTP</option>
                    <option value="manual">手动维护</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="project-source" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">绑定发布来源</label>
                  <select id="project-source" className="input-field" value={form.source_id} onChange={(e) => set('source_id', e.target.value)}>
                    <option value="">不绑定</option>
                    {sources.map((source) => <option key={source.id} value={source.id}>{source.name}（{source.owner}/{source.repo}）</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label htmlFor="project-interval" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">检查周期（分钟）</label><input id="project-interval" type="number" min="5" max="10080" className="input-field" value={form.check_interval_minutes} onChange={(e) => set('check_interval_minutes', Number(e.target.value || 5))} /></div>
                <div><label htmlFor="project-timeout" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">超时（毫秒）</label><input id="project-timeout" type="number" min="1000" max="600000" className="input-field" value={form.timeout_ms} onChange={(e) => set('timeout_ms', Number(e.target.value || 1000))} /></div>
              </div>
              <div><label htmlFor="project-local-path" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">本地目录（下载站内相对路径）</label><input id="project-local-path" className="input-field" value={form.local_path} onChange={(e) => set('local_path', e.target.value)} placeholder="Mindustry/Main（可选，用于目录状态绑定）" /></div>
            </>
          )}

          {tab === 'files' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label htmlFor="project-include" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">include 规则</label><input id="project-include" className="input-field" value={form.file_pattern} onChange={(e) => set('file_pattern', e.target.value)} placeholder="正则，例如 ^Mindustry.*\.apk$" /></div>
                <div><label htmlFor="project-exclude" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">exclude 规则</label><input id="project-exclude" className="input-field" value={form.file_exclude_pattern} onChange={(e) => set('file_exclude_pattern', e.target.value)} placeholder="正则，例如 source" /></div>
              </div>
              <div>
                <label htmlFor="project-expected" className="mb-1.5 block text-xs font-semibold" data-admin-style="text-secondary">期望文件（每行一个）</label>
                <textarea id="project-expected" className="input-field" rows={4} value={form.expected_assets} onChange={(e) => set('expected_assets', e.target.value)} placeholder={'Mindustry-MDT-Android.apk\nchecksum.sha256'} />
                <p className="mt-1 text-xs" data-admin-style="text-muted">列出的文件若尚未同步，会在状态页显示为「等待」。</p>
              </div>
            </>
          )}

          {tab === 'deps' && (
            <div>
              <p className="mb-2 text-xs font-semibold" data-admin-style="text-secondary">依赖项目（仅记录与展示，不做调度）</p>
              <div className="space-y-2">
                {projects.filter((item) => item.id !== project?.id).map((item) => (
                  <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm" data-admin-style="text-secondary">
                    <input
                      type="checkbox"
                      checked={form.depends_on.includes(item.id)}
                      onChange={(e) => set('depends_on', e.target.checked ? [...form.depends_on, item.id] : form.depends_on.filter((id) => id !== item.id))}
                    />
                    {item.name}
                  </label>
                ))}
                {projects.filter((item) => item.id !== project?.id).length === 0 && <p className="text-sm" data-admin-style="text-muted">还没有其他项目可作为依赖。</p>}
              </div>
            </div>
          )}

          {tab === 'notify' && (
            <div>
              <p className="mb-2 text-xs font-semibold" data-admin-style="text-secondary">自动通知（同一状态只保留一条，恢复后自动撤下）</p>
              <div className="space-y-2">
                {NOTIFY_FIELDS.map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm" data-admin-style="text-secondary">
                    <input type="checkbox" checked={Boolean(form.notify[key])} onChange={(e) => setNotify(key, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-xs" data-admin-style="text-muted">建议至少保留「同步延迟」「同步失败」「恢复正常」，避免项目异常时用户找不到原因。</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-4" data-admin-style="border">
          <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" disabled={saving}>{saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{saving ? '保存中...' : '保存项目'}</button>
        </div>
      </form>
    </div>
  );
}

function SyncProjects() {
  const { notify } = useToast();
  const [projects, setProjects] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSyncProjects();
      setProjects(result.projects || []);
      setSources(result.sources || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (id, action, fn, message) => {
    setBusy((v) => ({ ...v, [`${action}:${id}`]: true }));
    try {
      await fn();
      notify(message, 'success');
      await load();
    } catch (err) {
      notify(`${message}失败：${err.message}`, 'error');
      await load();
    } finally {
      setBusy((v) => ({ ...v, [`${action}:${id}`]: false }));
    }
  };

  const save = async (payload) => {
    setSaving(true);
    try {
      if (modal?.id) await api.updateSyncProject(modal.id, payload);
      else await api.createSyncProject(payload);
      notify('项目已保存', 'success');
      setModal(null);
      await load();
    } catch (err) {
      notify(`保存失败：${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center gap-3" data-admin-style="text-muted"><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">加载项目同步...</span></div>;
  if (error) return <div className="card flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-10 w-10" data-admin-style="text-error" /><p data-admin-style="text-secondary">加载失败：{error.message}</p><button className="btn-secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />重新加载</button></div>;

  const healthy = projects.filter((p) => p.status === 'synced').length;
  const syncing = projects.filter((p) => p.status === 'syncing').length;
  const attention = projects.filter((p) => ['failed', 'partial', 'delayed'].includes(p.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="page-title">项目同步</h2>
          <p className="mt-1 text-sm" data-admin-style="text-secondary">以项目视角管理同步状态，底层复用既有发布来源</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" to="/releases"><GitBranch className="mr-1.5 h-4 w-4" />发布来源</Link>
          <button className="btn-secondary" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />刷新</button>
          <button className="btn-primary" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />新建项目</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">项目总数</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text">{projects.length}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">已同步</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text-success">{healthy}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">同步中</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style="text-primary">{syncing}</p></div>
        <div className="card !p-4"><p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">需要关注</p><p className="mt-2 text-2xl font-bold tabular-nums" data-admin-style={attention ? 'text-error' : 'text'}>{attention}</p></div>
      </div>

      {projects.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center">
          <GitBranch className="mb-3 h-12 w-12 opacity-35" data-admin-style="text-muted" />
          <p className="font-medium" data-admin-style="text">还没有同步项目</p>
          <p className="mt-1 text-sm" data-admin-style="text-muted">创建一个项目并绑定发布来源，状态页就会展示它的同步进度。</p>
          <button className="btn-primary mt-5" onClick={() => setModal({})}><Plus className="mr-1.5 h-4 w-4" />新建第一个项目</button>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 940 }}>
              <thead>
                <tr><th>项目</th><th className="whitespace-nowrap">远端版本</th><th className="whitespace-nowrap">本地版本</th><th className="whitespace-nowrap">状态</th><th className="whitespace-nowrap">上次检查</th><th className="whitespace-nowrap">上次成功</th><th className="text-right whitespace-nowrap">操作</th></tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <p className="font-medium" data-admin-style="text">{project.name}</p>
                      <p className="mt-0.5 max-w-xs truncate text-xs" data-admin-style="text-muted">
                        {project.source ? `${project.source.owner}/${project.source.repo}` : '未绑定来源'}
                        {project.local_path ? ` · ${project.local_path}` : ''}
                        {project.enabled === false ? ' · 已停用' : ''}
                      </p>
                    </td>
                    <td className="text-sm" data-admin-style="text-secondary">{project.remote_version || '—'}</td>
                    <td className="text-sm" data-admin-style="text-secondary">{project.local_version || '—'}</td>
                    <td className="whitespace-nowrap">
                      <span className={`badge whitespace-nowrap ${STATUS_CLASS[project.status] || 'badge-neutral'}`}>{project.status_label}</span>
                      {project.status_reason && <p className="mt-1 max-w-xs truncate text-[11px]" data-admin-style="text-muted">{project.status_reason}</p>}
                    </td>
                    <td className="whitespace-nowrap text-xs" data-admin-style="text-muted">{date(project.last_check_at)}</td>
                    <td className="whitespace-nowrap text-xs" data-admin-style="text-muted">{date(project.last_success_at)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost !p-1.5" title="重新检查" disabled={busy[`check:${project.id}`]} onClick={() => run(project.id, 'check', () => api.checkSyncProject(project.id), '状态已刷新')}><CheckCircle2 className="h-4 w-4" /></button>
                        <button className="btn-ghost !p-1.5" title="立即同步" disabled={busy[`sync:${project.id}`]} onClick={() => run(project.id, 'sync', () => api.syncSyncProject(project.id), '同步已触发')}><Zap className={`h-4 w-4 ${busy[`sync:${project.id}`] ? 'animate-pulse' : ''}`} /></button>
                        <button className="btn-ghost !p-1.5" title="编辑" onClick={() => setModal(project)}>编辑</button>
                        <button className="btn-ghost !p-1.5" data-admin-style="text-error" title="删除" onClick={() => window.confirm(`确认删除项目“${project.name}”？`) && run(project.id, 'delete', () => api.deleteSyncProject(project.id), '项目已删除')}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && <ProjectModal project={modal.id ? modal : null} projects={projects} sources={sources} saving={saving} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

export default SyncProjects;
