// 在首次绘制前恢复用户的主题偏好，避免深色模式闪白。
// 独立成外部文件而非内联，是为了在 nonce-based CSP 下也能被放行
// （管理后台是静态产物，无法注入服务端生成的 nonce）。
(function () {
  var t = localStorage.getItem('theme');
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();
