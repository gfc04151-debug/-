// Встроенный плеер YouTube не играет на странице расширения (ошибки 152/153):
// ему нужен Referer обычного сайта. Подставляем его только для плееров
// youtube.com/embed, которые использует мультиэкран.
const RULE_ID = 1;
async function setupRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [{
      id: RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "set", value: "https://example.com/" }]
      },
      condition: {
        regexFilter: "^https://(www\\.)?youtube(-nocookie)?\\.com/embed/",
        resourceTypes: ["sub_frame"]
      }
    }]
  });
}
chrome.runtime.onInstalled.addListener(setupRules);
chrome.runtime.onStartup.addListener(setupRules);
