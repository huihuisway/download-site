const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const httpReq = (path, method = 'GET') => new Promise((res, rej) => {
  http.request({ host: '127.0.0.1', port: 9222, path, method }, (r) => {
    const c = []; r.on('data', (d) => c.push(d));
    r.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString())); } catch { res({}); } });
  }).on('error', rej).end();
});
(async () => {
  const pages = JSON.parse(process.argv[2]);
  for (const page of pages) {
    const target = await httpReq('/json/new?' + encodeURIComponent(page.url), 'PUT');
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    let id = 0; const pending = new Map(); const errors = [];
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map(a => a.value || a.description).join(' ').slice(0, 200));
      if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: page.width, height: page.height, deviceScaleFactor: 1, mobile: Boolean(page.mobile) });
    await new Promise((r) => setTimeout(r, 2500));
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(page.file, Buffer.from(data, 'base64'));
    const probe = await send('Runtime.evaluate', { expression: "document.body.innerText.slice(0, 160).replace(/\\n+/g,' | ')", returnByValue: true });
    console.log(page.file.split('/').pop(), '::', probe.result.value);
    if (errors.length) console.log('  ERRORS:', errors.slice(0, 3));
    ws.close();
    await httpReq('/json/close/' + target.id).catch(() => {});
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
