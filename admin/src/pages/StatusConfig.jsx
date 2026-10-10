import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertCircle, RefreshCw } from 'lucide-react';
import api from '../api/client';
import { useToast } from '../components/Toast';

const date = (value) => (value ? new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const STATUS_CLASS = {
  operational: 'badge-success',
  degraded: 'badge-warning',
  maintenance: 'badge-info',
  outage: 'badge-error',
  syncing: 'badge-info',
  unknown: 'badge-neutral',
  synced: 'badge-success',
  pending: 'badge-neutral',
  partial: 'badge-warning',
  delayed: 'badge-warning',
  failed: 'badge-error',
};

/**
 * 状态配置：实时查看服务状态与各项目同步状态，并跳转项目配置。
 * 真正的状态数据由服务端推导，这里不放「手动改状态」的入口，避免数据失真。
 */
function StatusConfig() {
  const { notify } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getStatusConfig());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const check = async (id) => {
    try {
      await api.checkSyncProject(id);
      notify('状态已刷新', 'success');
      await load();
    } catch (err) {
      notify(`刷新失败：${err.message}`, 'error');
    }
  };

  if (loading) return <div className="flex h-64 items-center justify-center gap-3" data-admin-style="text-muted"><RefreshCw className="h-5 w-5 animate-spin" /><span className="text-sm">加载状态...</span></div>;
  if (error) return <div className="card flex flex-col items-center gap-3 py-16 text-center"><AlertCircle className="h-10 w-10" data-admin-style="text-error" /><p data-admin-style="text-secondary">状态加载失败：{error.message}</p><button className="btn-secondary" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />重新加载</button></div>;

  const status = data?.status || {};
  const projects = data?.projects || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="page-title">状态配置</h2>
          <p className="mt-1 text-sm" data-admin-style="text-secondary">前台 /status 与服务状态入口的实时数据</p>
        </div>
        <div className="flex gap-2">
          <a className="btn-secondary" href="/status" target="_blank" rel="noreferrer">查看前台状态页</a>
          <button className="btn-secondary" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />刷新</button>
        </div>
      </div>

      <div className="card !p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`badge ${STATUS_CLASS[status.status] || 'badge-neutral'}`}>{status.status_label || '状态未知'}</span>
          <span className="text-xs" data-admin-style="text-muted">更新于 {date(status.updated_at)}</span>
          {status.maintenance && <span className="text-xs" data-admin-style="text-secondary">维护公告：{status.maintenance.title}</span>}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(status.services || []).map((service) => (
            <div key={service.key} className="card !p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium" data-admin-style="text">{service.name}</span>
                <span className={`badge ${STATUS_CLASS[service.status] || 'badge-neutral'}`}>{service.status_label}</span>
              </div>
              <p className="mt-2 text-xs" data-admin-style="text-muted">{service.detail || '—'}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4" data-admin-style="border">
          <h3 className="font-semibold" data-admin-style="text">项目状态</h3>
          <Link className="text-sm" to="/sync-projects" data-admin-style="text-primary">管理项目</Link>
        </div>
        {projects.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <Activity className="mb-3 h-10 w-10 opacity-35" data-admin-style="text-muted" />
            <p className="text-sm" data-admin-style="text-muted">还没有同步项目。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table" style={{ minWidth: 880 }}>
              <thead><tr><th>项目</th><th className="whitespace-nowrap">状态</th><th className="whitespace-nowrap">远端</th><th className="whitespace-nowrap">本地</th><th className="whitespace-nowrap">影响总体</th><th className="whitespace-nowrap">上次成功</th><th className="text-right whitespace-nowrap">操作</th></tr></thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <p className="font-medium" data-admin-style="text">{project.name}</p>
                      {project.status_reason && <p className="mt-0.5 max-w-sm truncate text-xs" data-admin-style="text-muted">{project.status_reason}</p>}
                    </td>
                    <td className="whitespace-nowrap"><span className={`badge whitespace-nowrap ${STATUS_CLASS[project.status] || 'badge-neutral'}`}>{project.status_label}</span></td>
                    <td className="text-sm" data-admin-style="text-secondary">{project.remote_version || '—'}</td>
                    <td className="text-sm" data-admin-style="text-secondary">{project.local_version || '—'}</td>
                    <td className="text-xs" data-admin-style="text-muted">{project.affects_global_status === false ? '否' : '是'}</td>
                    <td className="whitespace-nowrap text-xs" data-admin-style="text-muted">{date(project.last_success_at)}</td>
                    <td><div className="flex justify-end"><button className="btn-ghost !p-1.5" onClick={() => check(project.id)}>重新检查</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StatusConfig;
