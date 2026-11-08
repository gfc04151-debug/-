// Изолированный content script: передаёт настройки между popup и страницей.
const send = (data) => window.postMessage({ __ytDual: "to-page", ...data }, "*");

chrome.storage.local.get({ enabled: true, mode: "mix", speed: 0.25, quality: "tiny" },
  ({ enabled, mode, speed, quality }) => send({ enabled, mode, speed, quality }));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) send({ enabled: changes.enabled.newValue });
  if (changes.mode) send({ mode: changes.mode.newValue });
  if (changes.speed) send({ speed: changes.speed.newValue });
  if (changes.quality) send({ quality: changes.quality.newValue });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (window !== window.top) return;
  if (msg.type === "setVolume") { send({ volume: msg.volume }); reply({ ok: true }); return; }
  if (msg.type === "pauseVideo") {
    send({ pauseAll: true });
    reply({ ok: true });
    return;
  }
  if (msg.type === "getState") {
    const onMsg = (e) => {
      if (e.source !== window || !e.data || e.data.__ytDual !== "to-ext") return;
      window.removeEventListener("message", onMsg);
      reply({ volume: e.data.volume, pings: e.data.pings, signedIn: e.data.signedIn });
    };
    window.addEventListener("message", onMsg);
    send({ query: true });
    return true;
  }
});
