// Окна мультиэкрана — это страницы YouTube внутри страницы YouTube.
// На планшете www.youtube.com перенаправляет на m.youtube.com, и YouTube
// запрещает показывать такую страницу в окне (заголовок X-Frame-Options).
// Убираем этот запрет, но только для окон внутри YouTube.
async function setupRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: [{
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" }
        ]
      },
      condition: {
        requestDomains: ["youtube.com"],
        initiatorDomains: ["youtube.com"],
        resourceTypes: ["sub_frame"]
      }
    }]
  });
}
chrome.runtime.onInstalled.addListener(setupRules);

// ---------- Популярные ролики канала (для мультиэкрана) ----------
importScripts("channel.js");
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "channelTop") return;
  chrome.storage.local.get({ minMinutes: 3 }, ({ minMinutes }) => {
    topChannelVideos(msg.channel, msg.days, minMinutes * 60)
      .then((r) => reply({ ok: true, ...r }))
      .catch((e) => reply({ ok: false, error: e.message }));
  });
  return true; // ответ придёт позже
});
chrome.runtime.onStartup.addListener(setupRules);
