// Изолированный content script: передаёт настройки между popup и страницей.
const send = (data) => window.postMessage({ __ytDual: "to-page", ...data }, "*");

chrome.storage.local.get({ enabled: true }, ({ enabled }) => send({ enabled }));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) send({ enabled: changes.enabled.newValue });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (window !== window.top) return; // отвечает только главная страница
  if (msg.type === "setVolume") { send({ volume: msg.volume }); reply({ ok: true }); return; }
  if (msg.type === "getState") {
    const onMsg = (e) => {
      if (e.source !== window || !e.data || e.data.__ytDual !== "to-ext") return;
      window.removeEventListener("message", onMsg);
      reply({ volume: e.data.volume });
    };
    window.addEventListener("message", onMsg);
    send({ query: true });
    return true; // ответ асинхронный
  }
});
