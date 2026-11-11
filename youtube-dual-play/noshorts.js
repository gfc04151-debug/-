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
  let minSeconds = 180; // скрывать видео короче этого (0 — не скрывать)

  // Карточки обычных видео (без пунктов меню) — для проверки длины.
  const VIDEO_CARDS = ITEMS.filter((s) => !/guide|pivot/.test(s)).join(",");
  const DURATION = "badge-shape, ytd-thumbnail-overlay-time-status-renderer, ytm-thumbnail-overlay-time-status-renderer, .badge-shape-wiz__text";
  function durationOf(card) {
    for (const el of card.querySelectorAll(DURATION)) {
      const t = (el.textContent || "").trim();
      if (/^\d{1,2}(:\d{2}){1,2}$/.test(t)) {
        return t.split(":").reduce((sum, n) => sum * 60 + +n, 0);
      }
    }
    return null; // длина неизвестна (например, прямой эфир) — не трогаем
  }
  function sweepShort() {
    if (!enabled || !minSeconds) return;
    document.querySelectorAll(VIDEO_CARDS).forEach((card) => {
      if (card.dataset.ytdualShort) return;
      const sec = durationOf(card);
      if (sec !== null && sec < minSeconds) {
        card.style.display = "none";
        card.dataset.ytdualShort = "1";
      }
    });
  }
  // ---------- Старые видео ----------
  let maxAgeDays = 30; // скрывать видео старше этого (0 — не скрывать)
  const META = "#metadata-line, .inline-metadata-item, yt-content-metadata-view-model, " +
    "ytm-badge-and-byline-renderer, .YtmBadgeAndBylineRendererItemByline, .yt-core-attributed-string";
  // «3 days ago», «5mo ago», «1 month ago», «5 дней назад», «5 мес. назад», «год назад»...
  const AGO = /(\d+|an?|один|одна|одну)?\s*(?<![a-zа-яё])(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|[ywdhms]|секунд[а-яё]*|минут[а-яё]*|мин\.?|час[а-яё]*|ч\.?|дн[а-яё]*\.?|день|недел[а-яё]*|нед\.?|месяц[а-яё]*|мес\.?|год[а-яё]*|г\.?|лет)\s+(ago|назад)/i;
  const UNIT_DAYS = [
    [/^(mo|month|мес)/i, 30], [/^(s|m|h|секунд|минут|мин|час|ч)/i, 0], [/^(d|дн|день)/i, 1],
    [/^(w|недел|нед)/i, 7], [/^(y|год|г|лет)/i, 365],
  ];
  function ageDays(card) {
    const texts = [...card.querySelectorAll(META)].map((e) => e.textContent);
    if (!texts.length) texts.push(card.textContent);
    for (const t of texts) {
      const m = AGO.exec(t || "");
      if (!m) continue;
      const n = /^\d+$/.test(m[1] || "") ? +m[1] : 1;
      const unit = UNIT_DAYS.find(([re]) => re.test(m[2]));
      if (unit) return n * unit[1];
    }
    return null; // дата неизвестна — не трогаем
  }
  const isSearch = () => location.pathname === "/results";
  function sweepOld() {
    if (!enabled || !maxAgeDays || !isSearch()) return;
    document.querySelectorAll(VIDEO_CARDS).forEach((card) => {
      if (card.dataset.ytdualOld) return;
      const days = ageDays(card);
      if (days !== null && days >= maxAgeDays) {
        card.style.display = "none";
        card.dataset.ytdualOld = "1";
      }
    });
  }
  function unsweepOld() {
    document.querySelectorAll("[data-ytdual-old]").forEach((el) => {
      el.style.display = "";
      delete el.dataset.ytdualOld;
    });
  }

  // ---------- Фильтр поиска YouTube ----------
  // В поиск добавляем фильтр самого YouTube: «Тип: видео» и «Дата загрузки»
  // (за неделю / месяц / год). Так YouTube сразу ищет только свежие видео.
  // Если вы сами выбрали фильтры в поиске, их не трогаем.
  function searchFilter() {
    // У YouTube есть только «за неделю» (3), «за месяц» (4) и «за год» (5).
    // Берём ближайший период, который не меньше выбранного срока,
    // а лишнее (например, старше 2 месяцев) расширение скрывает само.
    const period = !maxAgeDays ? 0 : maxAgeDays <= 7 ? 3 : maxAgeDays <= 30 ? 4 : maxAgeDays <= 365 ? 5 : 0;
    const inner = period ? [0x08, period, 0x10, 0x01] : [0x10, 0x01];
    return btoa(String.fromCharCode(0x12, inner.length, ...inner));
  }
  function fixSearchUrl() {
    if (!enabled || !isSearch() || window.top !== window) return;
    const u = new URL(location.href);
    if (u.searchParams.has("sp") || !u.searchParams.get("search_query")) return;
    u.searchParams.set("sp", searchFilter());
    location.replace(u.toString());
  }
  // YouTube открывает поиск без перезагрузки страницы — проверяем адрес.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; fixSearchUrl(); }
  }, 400);

  function unsweepShort() {
    document.querySelectorAll("[data-ytdual-short]").forEach((el) => {
      el.style.display = "";
      delete el.dataset.ytdualShort;
    });
  }

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
    timer = setTimeout(() => { timer = null; sweep(); sweepShort(); sweepOld(); applyStyle(); }, 300);
  });

  function start() {
    applyStyle();
    sweep();
    sweepShort();
    sweepOld();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.storage.local.get({ hideShorts: true, minMinutes: 3, maxAgeDays: 30 }, (st) => {
    enabled = st.hideShorts;
    minSeconds = st.minMinutes * 60;
    maxAgeDays = st.maxAgeDays;
    fixSearchUrl();
    if (enabled) start();
  });
  chrome.storage.onChanged.addListener((c) => {
    if (c.maxAgeDays) {
      maxAgeDays = c.maxAgeDays.newValue;
      unsweepOld();
      sweepOld();
    }
    if (c.minMinutes) {
      minSeconds = c.minMinutes.newValue * 60;
      unsweepShort();
      sweepShort();
    }
    if (!c.hideShorts) return;
    enabled = c.hideShorts.newValue;
    if (enabled) start();
    else { observer.disconnect(); applyStyle(); unsweep(); unsweepShort(); unsweepOld(); }
  });
})();
