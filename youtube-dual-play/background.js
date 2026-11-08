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
chrome.runtime.onInstalled.addListener(() => {
  setupRules();
  // Обычные вкладки — с обычным звуком.
  chrome.storage.local.set({ mode: "normal" });
});
chrome.runtime.onStartup.addListener(setupRules);
