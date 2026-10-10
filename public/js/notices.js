/**
 * 通知页：仅做前端小交互（分类型筛选跳转前的即时反馈）。
 * 服务端已渲染好分类，这里不重复请求接口。
 */
(() => {
  document.querySelectorAll('.mdt-notice-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      const link = item.querySelector('h3 a');
      if (!link) return;
      // 点在链接以外的地方也能进详情，扩大触控热区（移动端友好）
      if (event.target.closest('a, button')) return;
      window.location.href = link.href;
    });
  });
})();
