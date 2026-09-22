import { useState, useEffect } from 'react';
import {
  Files,
  Download,
  HardDrive,
  FolderTree,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import api from '../api/client';
import { formatSize } from '../lib/utils';
import { useToast } from '../components/Toast';

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider" data-admin-style="text-muted">{label}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums" data-admin-style="text">
            {typeof value === 'number' ? value.toLocaleString('zh-CN') : value}
          </p>
          {sub && <p className="text-xs mt-1" data-admin-style="text-muted">{sub}</p>}
        </div>
        <div className="w-10 h-10 flex items-center justify-center" data-admin-style="bg-muted">
          <Icon className="w-5 h-5" data-admin-style="text-primary" />
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { notify } = useToast();

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await api.getStats();
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await api.sync();
      notify(`同步完成：新增 ${result.inserted}，更新 ${result.updated}，删除 ${result.deleted}`, 'success');
      await loadData();
    } catch (err) {
      notify(`同步失败：${err.message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3" data-admin-style="text-muted">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card flex flex-col items-center gap-3 py-16 text-center">
        <p data-admin-style="text-secondary">数据加载失败，请重试。</p>
        <button type="button" className="btn-secondary" onClick={loadData}>重新加载</button>
      </div>
    );
  }

  const { dashboard, topFiles, categoryStats, downloadClientStats = { total: 0, clients: [], platforms: [] } } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="page-title">数据概览</h2>
          <p className="text-sm mt-1" data-admin-style="text-secondary">文件下载站运行状态一览</p>
        </div>
        <button type="button" className="btn-primary" onClick={handleSync} disabled={syncing} aria-busy={syncing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同步中...' : '同步目录'}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Files} label="总文件" value={dashboard.totalFiles} />
        <StatCard icon={Download} label="总下载" value={dashboard.totalDownloads} />
        <StatCard icon={HardDrive} label="总大小" value={formatSize(dashboard.totalSize)} sub={`${dashboard.totalFiles} 个文件`} />
        <StatCard icon={FolderTree} label="分类数" value={dashboard.totalCategories} />
      </div>

      {/* Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Top 10 */}
        <div className="card p-4 lg:col-span-3">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4" data-admin-style="text-primary" />
            <h3 className="section-title">热门下载 Top 10</h3>
          </div>
          {topFiles.length === 0 ? (
            <div className="text-center py-10" data-admin-style="text-muted">
              <Download className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">暂无下载记录</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {topFiles.map((file, i) => (
                <div
                  key={file.id}
                  className="admin-list-row flex items-center gap-3 py-2.5 px-3 transition-colors group"
                >
                  <span
                    className="admin-rank w-7 h-7 flex items-center justify-center text-xs font-bold shrink-0"
                    data-top={i < 3}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-admin-style="text">{file.file_name}</p>
                    <p className="text-[11px]" data-admin-style="text-muted">{file.category} · {formatSize(file.file_size)}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums" data-admin-style="text">
                    {file.download_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Category Stats */}
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <FolderTree className="w-4 h-4" data-admin-style="text-primary" />
            <h3 className="section-title">分类统计</h3>
          </div>
          {categoryStats.length === 0 ? (
            <div className="text-center py-10" data-admin-style="text-muted">
              <FolderTree className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">暂无分类</p>
            </div>
          ) : (
            <div className="space-y-3">
              {categoryStats.map((cat) => (
                <div
                  key={cat.category}
                  className="p-3.5 transition-colors"
                  data-admin-style="border-light bg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold min-w-0 break-words" data-admin-style="text">{cat.category}</span>
                    <span className="badge-neutral">{cat.file_count} 文件</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs" data-admin-style="text-muted">
                    <span>{cat.total_downloads} 次下载</span>
                    <span>{formatSize(cat.total_size)}</span>
                  </div>
                  {/* Progress bar */}
                  <progress
                    className="admin-progress mt-2.5 block h-1.5 w-full overflow-hidden"
                    max="100"
                    value={Math.min(100, (cat.total_downloads / Math.max(1, dashboard.totalDownloads)) * 100)}
                    aria-label={`${cat.category} 下载占比`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Download client analytics */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="section-title">最近 30 天下载客户端</h3>
          <span className="badge-neutral">{downloadClientStats.total.toLocaleString('zh-CN')} 次</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" data-admin-style="text-muted">客户端 / 版本</h4>
            {downloadClientStats.clients.length ? (
              <ul className="divide-y" data-admin-style="border-light">
                {downloadClientStats.clients.map((client) => (
                  <li key={client.client} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 break-words">{client.client}</span><strong className="tabular-nums">{client.count}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm py-2" data-admin-style="text-muted">暂无客户端上报</p>}
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" data-admin-style="text-muted">平台</h4>
            {downloadClientStats.platforms.length ? (
              <ul className="divide-y" data-admin-style="border-light">
                {downloadClientStats.platforms.map((platform) => (
                  <li key={platform.platform} className="flex justify-between gap-3 py-2 text-sm">
                    <span>{platform.platform}</span><strong className="tabular-nums">{platform.count}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm py-2" data-admin-style="text-muted">暂无平台数据</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
