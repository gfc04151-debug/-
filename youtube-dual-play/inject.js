// Должен работать в контексте самой страницы YouTube.
(() => {
  // Старые сборки браузера (в т.ч. Kiwi) могут запустить файл в изолированном
  // мире. Тогда встраиваем его в страницу через <script>.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    if (document.documentElement && document.documentElement.hasAttribute("data-yt-dual")) return;
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    return;
  }

  if (window.__ytDualPlay) return;
  window.__ytDualPlay = true;
  try { document.documentElement.setAttribute("data-yt-dual", "1"); } catch (_) {}

  const state = { enabled: true, lastUserAction: 0 };
  const USER_WINDOW_MS = 1500;

  // ---------- 1. Страница всегда "видима" ----------
  const defineGetter = (obj, prop, getter) => {
    try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (_) {}
  };
  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  const realVis = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  defineGetter(Document.prototype, "hidden", function () {
    return state.enabled ? false : realHidden.get.call(this);
  });
  defineGetter(Document.prototype, "webkitHidden", function () {
    return state.enabled ? false : realHidden.get.call(this);
  });
  defineGetter(Document.prototype, "visibilityState", function () {
    return state.enabled ? "visible" : realVis.get.call(this);
  });
  defineGetter(Document.prototype, "webkitVisibilityState", function () {
    return state.enabled ? "visible" : realVis.get.call(this);
  });
  const realHasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function () {
    return state.enabled ? true : realHasFocus.call(this);
  };

  const swallow = (e) => { if (state.enabled) e.stopImmediatePropagation(); };
  for (const type of ["visibilitychange", "webkitvisibilitychange", "pagehide", "freeze"]) {
    document.addEventListener(type, swallow, true);
    window.addEventListener(type, swallow, true);
  }
  window.addEventListener("blur", (e) => {
    if (state.enabled && e.target === window) e.stopImmediatePropagation();
  }, true);

  // ---------- 2. Пауза только по желанию пользователя ----------
  const markUser = (e) => { if (e.isTrusted) state.lastUserAction = Date.now(); };
  for (const type of ["pointerdown", "mousedown", "keydown", "touchstart"]) {
    window.addEventListener(type, markUser, true);
  }
  // Команды из мультиэкрана (кнопки там) тоже считаем действием пользователя.
  window.addEventListener("message", (e) => {
    if (typeof e.data === "string" && e.data.includes('"command"')) state.lastUserAction = Date.now();
  }, true);

  if (navigator.mediaSession && navigator.mediaSession.setActionHandler) {
    const realSet = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      if (typeof handler !== "function") return realSet(action, handler);
      return realSet(action, (...args) => {
        state.lastUserAction = Date.now();
        return handler(...args);
      });
    };
  }

  const userRecentlyActed = () => Date.now() - state.lastUserAction < USER_WINDOW_MS;

  const realPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    if (state.enabled && !userRecentlyActed() && !this.ended && this.isConnected &&
        this.__ytDualPlaying) {
      return; // пауза не от пользователя — игнорируем
    }
    return realPause.call(this);
  };

  const mark = (v, on) => { if (v instanceof HTMLMediaElement) v.__ytDualPlaying = on; };
  document.addEventListener("playing", (e) => mark(e.target, true), true);
  document.addEventListener("emptied", (e) => mark(e.target, false), true);
  document.addEventListener("ended", (e) => mark(e.target, false), true);

  // Пауза всё же случилась (например, Android отдал звук другой вкладке) —
  // продолжаем. Но не больше 3 раз за 15 секунд, чтобы вкладки не
  // "перетягивали" звук друг у друга бесконечно.
  document.addEventListener("pause", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement)) return;
    if (userRecentlyActed()) { v.__ytDualPlaying = false; return; }
    if (!state.enabled || v.ended || !v.__ytDualPlaying) return;
    const now = Date.now();
    v.__ytDualResumes = (v.__ytDualResumes || []).filter((t) => now - t < 15000);
    if (v.__ytDualResumes.length >= 3) { v.__ytDualPlaying = false; return; }
    v.__ytDualResumes.push(now);
    setTimeout(() => {
      if (v.paused && !v.ended && !userRecentlyActed()) v.play().catch(() => {});
    }, 300);
  }, true);

  // ---------- 3. Без окна "Видео приостановлено. Продолжить просмотр?" ----------
  setInterval(() => {
    if (!state.enabled) return;
    try { window._lact = Date.now(); } catch (_) {}
    const btn = document.querySelector(
      "yt-confirm-dialog-renderer #confirm-button, ytmusic-you-there-renderer button, ytm-you-there-renderer button");
    if (btn && btn.offsetParent !== null) btn.click();
  }, 30000);

  // ---------- 4. Громкость и настройки (через bridge.js) ----------
  const applyVolume = (vol) => {
    document.querySelectorAll("video, audio").forEach((m) => {
      m.__ytDualVolume = vol;
      m.volume = vol;
    });
  };
  document.addEventListener("volumechange", (e) => {
    const m = e.target;
    if (m instanceof HTMLMediaElement && typeof m.__ytDualVolume === "number" &&
        !userRecentlyActed() && Math.abs(m.volume - m.__ytDualVolume) > 0.01) {
      m.volume = m.__ytDualVolume;
    }
  }, true);

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__ytDual !== "to-page") return;
    const d = e.data;
    if (typeof d.enabled === "boolean") state.enabled = d.enabled;
    if (typeof d.volume === "number") applyVolume(d.volume);
    if (d.pauseAll) {
      state.lastUserAction = Date.now(); // это пауза по просьбе пользователя
      document.querySelectorAll("video, audio").forEach((m) => m.pause());
    }
    if (d.query) {
      const v = document.querySelector("video");
      window.postMessage({ __ytDual: "to-ext", volume: v ? v.volume : 1, enabled: state.enabled }, "*");
    }
  });
})();
