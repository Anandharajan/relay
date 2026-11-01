/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';

/** Shows a reload bar when a new build is ready, and rechecks hourly for tabs left open. */
export function watchForUpdates() {
  const update = registerSW({
    onNeedRefresh() {
      if (document.getElementById('update-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'update-bar';
      bar.setAttribute('role', 'status');
      bar.style.cssText =
        'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:8px;background:#111827;color:#fff;font:14px system-ui;max-width:calc(100vw - 32px)';
      bar.textContent = 'A new version is ready.';
      const reload = document.createElement('button');
      reload.textContent = 'Reload';
      reload.style.cssText = 'padding:4px 10px;border:0;border-radius:6px;background:#fff;color:#111827;cursor:pointer';
      reload.onclick = () => void update(true);
      bar.append(reload);
      document.body.append(bar);
    },
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), 3600_000);
    },
  });
}
