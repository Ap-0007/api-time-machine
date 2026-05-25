// Inject the page-world script via a web-accessible script tag.
(function injectATM() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// Forward captures from page world to the background service worker.
window.addEventListener('message', (ev) => {
  if (!ev.data?.__ATM__ || ev.source !== window) return;
  chrome.runtime.sendMessage(ev.data).catch(() => {});
});

// Receive replay directives from the background.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'REPLAY_INJECT') {
    const s = document.createElement('script');
    s.textContent = `window.__ATM_REPLAY_MAP__ = ${JSON.stringify(msg.snapshot)};
window.__ATM_STRICT_MODE__ = ${!!msg.strict};`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  } else if (msg.type === 'REPLAY_CLEAR') {
    const s = document.createElement('script');
    s.textContent = `delete window.__ATM_REPLAY_MAP__; delete window.__ATM_STRICT_MODE__;`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
});
