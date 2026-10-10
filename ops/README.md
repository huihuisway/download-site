# 下载站新机运维

新服务器的非敏感配置清单见 [`download-site-new.yaml`](download-site-new.yaml)。该 YAML 是给运维人员和后续 agent 使用的记录，不会被 Express 自动加载。自动同步开关位于服务器 `.env`，来源规则位于 `data/stats.db`；不要把 `.env` 内容或私钥写入仓库。

## SSH 登录

在已配置的这台电脑上执行：

```bash
ssh download-site-new
```

本机现有 Ed25519 公钥已加入新机 root 账户的 `authorized_keys`。`~/.ssh/config` 中的 `download-site-new` 使用 `root@211.101.247.246` 跳转并强制公钥认证。私钥只留在本机 `~/.ssh/id_ed25519`。其他电脑需要各自安全地安装公钥；不要复制本机私钥。

旧 SSH 别名 `download-site` 指向旧服务器 `64.81.112.98`，且当前出现主机指纹不匹配提示。不要关闭主机校验或删除旧指纹来绕过；新机别名直接通过中转机连接。

## 服务与网络

- 应用目录：`/disk-1/file/download-site`
- 文件目录：`/disk-1/file/app-file`
- systemd：`download-site.service`
- 日志：`journalctl -u download-site.service`
- 本机探测：`curl -I http://127.0.0.1:3322/`
- 3322 端口由 `download-site-port-guard.service` 限制为本机访问。不要开放公网 3322。
- OpenResty 的 80/443 尚未配置下载站反向代理；新机尚未接管现有域名/CDN 流量。

常用只读检查：

```bash
ssh download-site-new 'systemctl is-active download-site.service'
ssh download-site-new 'journalctl -u download-site.service -n 80 --no-pager'
```

## Release 自动同步

新机 `.env` 中 `RELEASE_SYNC_ENABLED=true`。打开该总开关后，调度器会处理数据库中所有启用的来源，并按各来源的 `sync_interval_ms` 检查。

- BookMdtLauncher 来源每小时检查一次，包含预发布版，只匹配 `BookMindustryLauncher.exe`，目标目录为 `BookMdtLauncher/<tag>/`。
- Mindustry MDT Android 来源由 `MINDUSTRY_ANDROID_RELEASE_REPOSITORY=huihuisway/download-site` 配置，每小时只同步最新稳定版的 `Mindustry-MDT-Android-<version>.apk`。已导入 160.5、160.6、160.7；历史版本保留，文件位于 `Mindustry/Main/Stable/<version>/android/`。这是 MDT 签名的社区构建，不是 Anuken 官方签名包。

`.exe` 默认属于拒绝扩展名。BookMdtLauncher 通过来源配置 `allow_executable_assets: true` 和 `src/services/release-sync.service.js` 中的精确仓库白名单双重限制。不要把 `.exe` 加入全局白名单，也不要移除仓库匹配条件。当前白名单改动尚未提交；部署 Git 版本时先保留这项改动，否则此来源的同步会因无匹配资产而失败。

数据库是单进程 JSON 文件数据库。不要在应用运行时从另一个进程并发修改 `data/stats.db`；需要直接维护时先停服务并备份。旧服务器仍运行同步任务，因此两台服务器可能各自同步相同的来源；新机切流或调整旧机任务前先核实当前生产路由和用户授权范围。
