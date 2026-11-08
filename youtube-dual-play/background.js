// Правила для окон мультиэкрана.
// 1) Встроенный плеер YouTube не играет на странице расширения (ошибки 152/153):
//    ему нужен Referer обычного сайта.
// 2) Полная страница YouTube запрещает показывать себя внутри другой страницы
//    (заголовки X-Frame-Options и CSP). Убираем их, но только для окон,
//    которые открыло само расширение.
async function setupRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "referer", operation: "set", value: "https://example.com/" }]
        },
        condition: {
          regexFilter: "^https://(www\\.)?youtube(-nocookie)?\\.com/embed/",
          resourceTypes: ["sub_frame"],
          initiatorDomains: [chrome.runtime.id]
        }
      },
      {
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
          resourceTypes: ["sub_frame"],
          initiatorDomains: [chrome.runtime.id]
        }
      }
    ]
  });
}
chrome.runtime.onInstalled.addListener(setupRules);
chrome.runtime.onStartup.addListener(setupRules);
