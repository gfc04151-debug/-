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

  // mode: "normal" — как обычно; "silent" — все вкладки без звука;
  // "mix" — звук есть, но вкладки не отбирают его друг у друга.
  const state = { enabled: true, mode: "mix", speed: 0.25, quality: "tiny", lastUserAction: 0 };
  const forcedMute = () => state.enabled && (state.mode === "silent" || state.mode === "mix");
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
  for (const type of ["visibilitychange", "webkitvisibilitychange"]) {
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
  // продолжаем. Со звуком — не больше 3 раз за 15 секунд, чтобы вкладки не
  // "перетягивали" звук друг у друга бесконечно. В тихом режиме вкладки
  // друг другу не мешают, поэтому продолжаем всегда (не чаще раза в секунду).
  document.addEventListener("pause", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement)) return;
    if (userRecentlyActed()) { v.__ytDualPlaying = false; v.__ytDualUserPaused = true; return; }
    if (!state.enabled || v.ended || !v.__ytDualPlaying) return;
    const now = Date.now();
    v.__ytDualResumes = (v.__ytDualResumes || []).filter((t) => now - t < 15000);
    if (!forcedMute() && v.__ytDualResumes.length >= 3) { v.__ytDualPlaying = false; return; }
    v.__ytDualResumes.push(now);
    setTimeout(() => {
      if (v.paused && !v.ended && !userRecentlyActed()) v.play().catch(() => {});
    }, forcedMute() ? 1000 : 300);
  }, true);
  document.addEventListener("play", (e) => {
    if (e.target instanceof HTMLMediaElement) e.target.__ytDualUserPaused = false;
  }, true);

  // ---------- Тихий режим и режим "mix" ----------
  // Видео с выключенным звуком не забирает звук у других вкладок (на Android
  // звук может принадлежать только одной вкладке). В режиме "mix" звук
  // берём из видео отдельно и играем через Web Audio — так все вкладки
  // звучат одновременно и не останавливают друг друга.
  const silence = (m) => {
    if (forcedMute() && m instanceof HTMLMediaElement && !m.muted) m.muted = true;
  };

  let audioCtx = null;
  const getCtx = () => {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  };
  // Браузер разрешает включить звук только после касания вкладки.
  for (const type of ["pointerdown", "keydown", "touchend"]) {
    window.addEventListener(type, () => { if (state.mode === "mix" && state.enabled) getCtx(); }, true);
  }

  const mixGain = (v) => (v.__ytDualGain ? v.__ytDualGain.gain : null);
  const connectTrack = (v) => {
    const ctx = getCtx();
    if (!ctx || !v.__ytDualStream) return;
    const track = v.__ytDualStream.getAudioTracks().find((t) => t.readyState === "live");
    if (!track || v.__ytDualTrack === track) return;
    if (v.__ytDualSource) { try { v.__ytDualSource.disconnect(); } catch (_) {} }
    if (!v.__ytDualGain) {
      v.__ytDualGain = ctx.createGain();
      v.__ytDualGain.connect(ctx.destination);
    }
    v.__ytDualGain.gain.value = v.volume;
    v.__ytDualSource = ctx.createMediaStreamSource(new MediaStream([track]));
    v.__ytDualSource.connect(v.__ytDualGain);
    v.__ytDualTrack = track;
  };
  const startMix = (v) => {
    if (!(v instanceof HTMLVideoElement) || state.mode !== "mix" || !state.enabled) return;
    silence(v);
    if (!v.__ytDualStream) {
      try {
        v.__ytDualStream = (v.captureStream || v.mozCaptureStream).call(v);
        v.__ytDualStream.addEventListener("addtrack", () => connectTrack(v));
      } catch (_) { return; }
    }
    connectTrack(v);
    if (v.__ytDualGain) v.__ytDualGain.gain.value = v.volume;
  };
  const stopMix = () => {
    document.querySelectorAll("video").forEach((v) => {
      if (v.__ytDualGain) v.__ytDualGain.gain.value = 0;
    });
  };

  for (const type of ["loadstart", "loadedmetadata", "play", "playing", "volumechange"]) {
    document.addEventListener(type, (e) => {
      silence(e.target);
      if (state.mode === "mix") startMix(e.target);
      else if (e.target && e.target.__ytDualGain) e.target.__ytDualGain.gain.value = 0;
    }, true);
  }
  // Видео, которое не запустилось само (вкладка открыта в фоне), запускаем.
  const kick = () => {
    if (!forcedMute()) return;
    document.querySelectorAll("video").forEach((v) => {
      silence(v);
      startMix(v);
      if (v.paused && !v.ended && !v.__ytDualUserPaused && v.readyState >= 2 && v.isConnected) {
        v.play().catch(() => {});
      }
    });
  };
  document.addEventListener("canplay", kick, true);
  setInterval(kick, 3000);

  // ---------- Скорость и качество по умолчанию ----------
  // quality: tiny = 144p, small = 240p, medium = 360p, large = 480p, hd720 = 720p.
  const player = () => document.querySelector("#movie_player, .html5-video-player");
  // Только для плееров мультиэкрана (у них в адресе есть ytdual=1).
  // Обычные вкладки YouTube не трогаем.
  const inMultiview = /[?&]ytdual=1/.test(location.search);
  // YouTube запоминает качество, скорость и громкость для всего сайта.
  // Мультиэкран не должен менять эти настройки в обычных вкладках.
  const SHARED_KEYS = /^yt-player-(quality|playback-rate|volume)/;
  if (inMultiview) {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === window.localStorage && SHARED_KEYS.test(String(key))) return;
      return realSetItem.call(this, key, value);
    };
  } else {
    // Один раз убираем 144p, которое прошлая версия успела сохранить.
    try {
      if (!localStorage.getItem("ytdual-cleaned-v1")) {
        localStorage.removeItem("yt-player-quality");
        localStorage.setItem("ytdual-cleaned-v1", "1");
      }
    } catch (_) {}
  }
  const applyDefaults = (v, force) => {
    if (!inMultiview || !(v instanceof HTMLVideoElement)) return;
    const key = v.currentSrc || v.src;
    if (!force && v.__ytDualAppliedFor === key) return;
    v.__ytDualAppliedFor = key;
    const p = player();
    if (state.speed) {
      try { if (p && p.setPlaybackRate) p.setPlaybackRate(state.speed); } catch (_) {}
      v.playbackRate = state.speed;
    }
    if (state.quality && p) {
      try { if (p.setPlaybackQualityRange) p.setPlaybackQualityRange(state.quality, state.quality); } catch (_) {}
      try { if (p.setPlaybackQuality) p.setPlaybackQuality(state.quality); } catch (_) {}
    }
  };
  for (const type of ["loadedmetadata", "playing"]) {
    document.addEventListener(type, (e) => applyDefaults(e.target), true);
  }
  // YouTube иногда сам возвращает скорость 1 — ставим обратно,
  // если скорость поменял не пользователь.
  document.addEventListener("ratechange", (e) => {
    const v = e.target;
    if (inMultiview && state.speed && v instanceof HTMLVideoElement && !userRecentlyActed() &&
        Math.abs(v.playbackRate - state.speed) > 0.001) {
      v.playbackRate = state.speed;
    }
  }, true);

  // ---------- Проверка: отправляет ли YouTube данные о просмотре ----------
  // Запись в историю появляется после запроса /api/stats/playback.
  // Если его нет или он с ошибкой — историю блокирует что-то другое
  // (блокировщик рекламы, настройки браузера или аккаунта).
  const pings = { playback: 0, watchtime: 0, failed: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const kind = /\/api\/stats\/playback/.test(e.name) ? "playback"
          : /\/api\/stats\/watchtime/.test(e.name) ? "watchtime" : null;
        if (!kind) continue;
        pings[kind]++;
        if (e.responseStatus !== undefined && e.responseStatus !== 0 && e.responseStatus >= 400) pings.failed++;
      }
    }).observe({ type: "resource", buffered: true });
  } catch (_) {}
  // Запросы, которые не дошли (заблокированы), в список не попадают —
  // ловим ошибки отдельно.
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const p = realFetch.apply(this, arguments);
    if (/\/api\/stats\/(playback|watchtime)/.test(url)) p.catch(() => { pings.failed++; });
    return p;
  };

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
    if ("speed" in d || "quality" in d) {
      if ("speed" in d) state.speed = +d.speed || 0;
      if ("quality" in d) state.quality = d.quality || "";
      document.querySelectorAll("video").forEach((v) => applyDefaults(v, true));
    }
    if (typeof d.mode === "string" && d.mode !== state.mode) {
      const was = state.mode;
      state.mode = d.mode;
      if (d.mode !== "mix") stopMix();
      if (forcedMute()) kick();
      else if (was !== "normal") document.querySelectorAll("video, audio").forEach((m) => { m.muted = false; });
    }
    if (typeof d.volume === "number") applyVolume(d.volume);
    if (d.pauseAll) {
      state.lastUserAction = Date.now(); // это пауза по просьбе пользователя
      document.querySelectorAll("video, audio").forEach((m) => m.pause());
    }
    if (d.query) {
      const v = document.querySelector("video");
      window.postMessage({ __ytDual: "to-ext", volume: v ? v.volume : 1, enabled: state.enabled,
        pings, signedIn: /(^|; )(SID|__Secure-3PSID|SAPISID)=/.test(document.cookie) || !!document.querySelector("#avatar-btn, ytm-topbar-menu-button-renderer img, button#avatar-btn") }, "*");
    }
  });
})();
