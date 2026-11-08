// Мультиэкран: 4 окна YouTube без звука.
// Открывается прямо на сайте YouTube (служебная страница robots.txt#ytdual),
// чтобы окна были "своими" для YouTube: так они получают все cookie вашего
// аккаунта — работает вход, история просмотров и нет капчи "необычный трафик".
(() => {
  if (location.hash !== "#ytdual" || window.top !== window) return;

  const CSS = `
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #000; color: #f1f1f1; font: 14px system-ui, sans-serif; }
    body { display: flex; flex-direction: column; }
    header { display: flex; gap: 6px; padding: 6px; background: #181818; flex-wrap: wrap; align-items: center; }
    header b { margin-right: auto; }
    button { font: inherit; border: 0; border-radius: 8px; padding: 8px 12px; background: #333; color: #fff; }
    button.red { background: #ff0033; }
    #grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 4px; padding: 4px; min-height: 0; }
    @media (max-width: 600px) and (orientation: portrait) {
      #grid { grid-template-columns: 1fr; grid-template-rows: repeat(4, 1fr); }
    }
    .cell { display: flex; flex-direction: column; background: #111; border-radius: 6px; overflow: hidden; min-height: 0; }
    .player { flex: 1; position: relative; min-height: 0; }
    .player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .empty { position: absolute; inset: 0; display: grid; place-items: center; color: #777; text-align: center; padding: 10px; }
    .bar { display: flex; gap: 4px; padding: 4px; align-items: center; background: #1c1c1c; }
    .bar input { flex: 1; min-width: 0; font: inherit; padding: 6px; border-radius: 6px; border: 1px solid #333; background: #000; color: #fff; }
    .bar button { padding: 6px 9px; }`;

  document.documentElement.innerHTML = `
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Мультиэкран YouTube</title><style>${CSS}</style></head>
    <body>
      <header>
        <b>▶▶ Мультиэкран (без звука)</b>
        <button class="red" id="playAll">▶ Все</button>
        <button id="pauseAll">⏸ Все</button>
        <button id="login">Войти в аккаунт</button>
        <button id="reload">⟳</button>
        <button id="keepAlive">Работа в фоне: выкл</button>
        <button id="toggleBars">Скрыть панели</button>
      </header>
      <div id="grid"></div>
    </body>`;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const players = [];

  function videoId(text) {
    text = (text || "").trim();
    if (/^[\w-]{11}$/.test(text)) return text;
    try {
      const u = new URL(text);
      if (u.hostname === "youtu.be") return u.pathname.slice(1, 12);
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
      return m ? m[2] : null;
    } catch (_) { return null; }
  }

  // Команды окну (их выполняет inject.js внутри окна).
  function command(p, cmd, value) {
    const f = p.cell.querySelector("iframe");
    if (f && f.contentWindow) f.contentWindow.postMessage({ __ytDual: "mv", cmd, value }, "*");
  }

  function render(p, id) {
    if (p.id === id) return;
    p.id = id;
    const box = p.cell.querySelector(".player");
    box.textContent = "";
    if (!id) {
      const e = document.createElement("div");
      e.className = "empty";
      e.innerHTML = "Вставьте ссылку ниже<br>или добавьте видео из другой вкладки через значок расширения";
      box.appendChild(e);
      return;
    }
    const f = document.createElement("iframe");
    f.name = "ytdual-frame"; // по этому имени окно понимает, что оно в мультиэкране
    f.src = `${location.origin}/watch?v=${id}&ytdual=1`;
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    f.addEventListener("load", () => command(p, "play"));
    box.appendChild(f);
  }

  for (let i = 0; i < 4; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = `<div class="player"></div>
      <div class="bar"><input type="text" placeholder="Ссылка на видео ${i + 1}"><button title="Убрать">✕</button></div>`;
    grid.appendChild(cell);
    const p = { cell, id: undefined };
    players.push(p);
    const [input, clearBtn] = cell.querySelectorAll(".bar > *");
    input.addEventListener("change", () => {
      const id = videoId(input.value);
      if (id) setSlot(i, id);
      input.value = "";
    });
    clearBtn.addEventListener("click", () => setSlot(i, ""));
  }

  async function setSlot(i, id) {
    const { slots = ["", "", "", ""] } = await chrome.storage.local.get("slots");
    slots[i] = id;
    await chrome.storage.local.set({ slots });
  }

  const load = (slots) => players.forEach((p, i) => render(p, slots[i] || ""));
  chrome.storage.local.get({ slots: ["", "", "", ""] }, ({ slots }) => load(slots));
  chrome.storage.onChanged.addListener((c) => { if (c.slots) load(c.slots.newValue); });

  $("playAll").addEventListener("click", () => players.forEach((p) => command(p, "play")));
  $("pauseAll").addEventListener("click", () => players.forEach((p) => command(p, "pause")));
  $("login").addEventListener("click", () => window.open(
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F", "_blank"));
  $("reload").addEventListener("click", () => location.reload());

  // ---------- Работа в фоне ----------
  // Android замораживает фоновые вкладки без звука. Играем почти неслышный
  // сигнал (около -60 дБ, ниже порога слуха при обычной громкости), чтобы
  // браузер считал вкладку звучащей и не останавливал её.
  // Браузер разрешает звук только после касания, поэтому включаем
  // при первом нажатии в любом месте мультиэкрана.
  let keepCtx = null;
  const keepBtn = $("keepAlive");
  function startKeepAlive() {
    try {
      if (!keepCtx) {
        keepCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = keepCtx.createOscillator();
        osc.frequency.value = 40;
        const gain = keepCtx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain).connect(keepCtx.destination);
        osc.start();
        keepCtx.addEventListener("statechange", showKeepAlive);
      }
      if (keepCtx.state !== "running") keepCtx.resume().catch(() => {});
    } catch (_) {}
    showKeepAlive();
  }
  function showKeepAlive() {
    const on = keepCtx && keepCtx.state === "running";
    keepBtn.textContent = on ? "Работа в фоне: вкл" : "Работа в фоне: выкл";
    keepBtn.className = on ? "" : "red";
  }
  showKeepAlive();
  keepBtn.addEventListener("click", startKeepAlive);
  document.addEventListener("pointerdown", startKeepAlive, true);
  // Если браузер всё же приостановил звук — возобновляем.
  setInterval(() => { if (keepCtx && keepCtx.state !== "running") keepCtx.resume().catch(() => {}); }, 5000);
  $("toggleBars").addEventListener("click", (e) => {
    const hide = e.target.textContent === "Скрыть панели";
    document.querySelectorAll(".bar").forEach((b) => (b.style.display = hide ? "none" : ""));
    e.target.textContent = hide ? "Показать панели" : "Скрыть панели";
  });
})();
