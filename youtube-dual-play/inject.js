// Работает в контексте самой страницы YouTube (world: MAIN).
(() => {
  if (window.__ytDualPlay) return;
  window.__ytDualPlay = true;

  const state = { enabled: true, lastUserAction: 0 };
  const USER_WINDOW_MS = 1500;

  // ---------- 1. Страница всегда "видима" ----------
  // YouTube и браузер замедляют/ставят на паузу фоновые вкладки.
  // Говорим странице, что она всегда на экране и в фокусе.
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

  // Глушим события ухода со вкладки, пока страница их не увидела.
  const swallow = (e) => { if (state.enabled) e.stopImmediatePropagation(); };
  for (const type of ["visibilitychange", "webkitvisibilitychange", "pagehide", "freeze"]) {
    document.addEventListener(type, swallow, true);
    window.addEventListener(type, swallow, true);
  }
  window.addEventListener("blur", (e) => {
    if (state.enabled && e.target === window) e.stopImmediatePropagation();
  }, true);

  // ---------- 2. Пауза только по желанию пользователя ----------
  // Запоминаем момент последнего действия человека в этой вкладке.
  const markUser = (e) => { if (e.isTrusted) state.lastUserAction = Date.now(); };
  for (const type of ["pointerdown", "mousedown", "keydown", "touchstart"]) {
    window.addEventListener(type, markUser, true);
  }

  // Мультимедийные клавиши и пауза из шторки/панели браузера тоже считаются.
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

  // Блокируем "автоматическую" паузу, которую YouTube делает,
  // когда видео запускается в другой вкладке.
  const realPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    if (state.enabled && !userRecentlyActed() && !this.ended && this.isConnected &&
        this.__ytDualPlaying) {
      return; // пауза не от пользователя — игнорируем
    }
    return realPause.call(this);
  };

  // Помечаем видео, которые реально играют (чтобы не мешать загрузке и рекламе).
  document.addEventListener("playing", (e) => {
    if (e.target instanceof HTMLMediaElement) e.target.__ytDualPlaying = true;
  }, true);
  document.addEventListener("emptied", (e) => {
    if (e.target instanceof HTMLMediaElement) e.target.__ytDualPlaying = false;
  }, true);
  document.addEventListener("ended", (e) => {
    if (e.target instanceof HTMLMediaElement) e.target.__ytDualPlaying = false;
  }, true);

  // Если пауза всё же случилась без участия пользователя — сразу продолжаем.
  document.addEventListener("pause", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement)) return;
    if (!state.enabled || userRecentlyActed() || v.ended || !v.__ytDualPlaying) {
      if (userRecentlyActed()) v.__ytDualPlaying = false;
      return;
    }
    setTimeout(() => {
      if (v.paused && !v.ended && !userRecentlyActed()) v.play().catch(() => {});
    }, 50);
  }, true);

  // ---------- 3. Без окна "Видео приостановлено. Продолжить просмотр?" ----------
  setInterval(() => {
    if (!state.enabled) return;
    try { window._lact = Date.now(); } catch (_) {}
    const dlg = document.querySelector("yt-confirm-dialog-renderer #confirm-button, ytmusic-you-there-renderer button");
    if (dlg && dlg.offsetParent !== null) dlg.click();
  }, 30000);

  // ---------- 4. Связь с popup (через bridge.js) ----------
  const applyVolume = (vol) => {
    document.querySelectorAll("video, audio").forEach((m) => {
      m.__ytDualVolume = vol;
      m.volume = vol;
    });
  };
  // YouTube иногда сам сбрасывает громкость — возвращаем нашу.
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
    if (d.query) {
      const v = document.querySelector("video");
      window.postMessage({
        __ytDual: "to-ext",
        volume: v ? v.volume : 1,
        enabled: state.enabled
      }, "*");
    }
  });
})();
