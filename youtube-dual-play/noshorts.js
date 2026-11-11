// Скрывает Shorts в поиске, на главной, в рекомендациях и в меню YouTube
// (и на www.youtube.com, и на m.youtube.com). Включается в окне расширения.
(() => {
  const STYLE_ID = "ytdual-noshorts";
  // Признаки Shorts: ссылка на /shorts/ или значок Shorts на картинке.
  const SHORT_LINK = 'a[href^="/shorts"], a[href*="youtube.com/shorts/"], ' +
    '[overlay-style="SHORTS"], [data-style="SHORTS"]';

  // Блоки, которые целиком состоят из Shorts.
  const SHELVES = [
    "ytd-reel-shelf-renderer", "ytm-reel-shelf-renderer",
    "ytd-rich-shelf-renderer[is-shorts]",
    "ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
    "ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)",
    "grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)",
    "ytm-shorts-lockup-view-model", "ytm-shorts-lockup-view-model-v2",
    // пункт «Shorts» в меню
    'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
    "ytm-pivot-bar-item-renderer:has(.pivot-shorts)",
  ];
  // Отдельные видео в списке, если ссылка ведёт на Shorts.
  const ITEMS = [
    "ytd-video-renderer", "ytd-rich-item-renderer", "ytd-grid-video-renderer",
    "ytd-compact-video-renderer", "yt-lockup-view-model",
    "ytm-video-with-context-renderer", "ytm-compact-video-renderer", "ytm-rich-item-renderer",
    "ytm-item-section-renderer > lazy-list > ytm-media-item",
    // пункт «Shorts» в меню
    "ytd-guide-entry-renderer", "ytd-mini-guide-entry-renderer", "ytm-pivot-bar-item-renderer",
  ];
  const CSS = [...SHELVES, ...ITEMS.map((s) => `${s}:has(${SHORT_LINK.split(", ").join(`), ${s}:has(`)})`)]
    .join(",\n") + " { display: none !important; }";

  let enabled = true;

  function applyStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!enabled) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    }
  }

  // Запасной способ для браузеров без :has и для новых вариантов вёрстки:
  // находим ссылки на Shorts и прячем карточку, в которой они лежат.
  const ITEM_SELECTOR = ITEMS.join(",");
  function sweep() {
    if (!enabled) return;
    document.querySelectorAll(SHORT_LINK).forEach((a) => {
      const card = a.closest(ITEM_SELECTOR);
      if (card && card.style.display !== "none") {
        card.style.display = "none";
        card.dataset.ytdualHidden = "1";
      }
    });
  }
  function unsweep() {
    document.querySelectorAll("[data-ytdual-hidden]").forEach((el) => {
      el.style.display = "";
      delete el.dataset.ytdualHidden;
    });
  }

  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; sweep(); applyStyle(); }, 300);
  });

  function start() {
    applyStyle();
    sweep();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.local.get({ hideShorts: true }, ({ hideShorts }) => {
    enabled = hideShorts;
    if (enabled) start();
  });
  chrome.storage.onChanged.addListener((c) => {
    if (!c.hideShorts) return;
    enabled = c.hideShorts.newValue;
    if (enabled) start();
    else { observer.disconnect(); applyStyle(); unsweep(); }
  });
})();
