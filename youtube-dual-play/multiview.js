const grid = document.getElementById("grid");
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

// Команды встроенному плееру YouTube (без загрузки внешних скриптов).
function command(p, func, args = []) {
  const f = p.cell.querySelector("iframe");
  if (f && f.contentWindow) {
    f.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  }
}

function render(p, id) {
  const box = p.cell.querySelector(".player");
  if (p.id === id) return;
  p.id = id;
  box.innerHTML = "";
  if (!id) {
    box.innerHTML = '<div class="empty">Вставьте ссылку ниже<br>или добавьте видео из другой вкладки через значок расширения</div>';
    return;
  }
  const f = document.createElement("iframe");
  f.src = `https://www.youtube.com/embed/${id}?ytdual=1&enablejsapi=1&playsinline=1&autoplay=1&rel=0`;
  f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  f.referrerPolicy = "strict-origin-when-cross-origin";
  f.addEventListener("load", () => command(p, "setVolume", [p.volume]));
  box.appendChild(f);
}

for (let i = 0; i < 4; i++) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.innerHTML = `
    <div class="player"></div>
    <div class="bar">
      <input type="text" placeholder="Ссылка на видео ${i + 1}">
      <button title="Выключить звук">🔊</button>
      <input type="range" min="0" max="100" value="100" title="Громкость">
      <button title="Убрать">✕</button>
    </div>`;
  grid.appendChild(cell);
  const p = { cell, id: undefined, volume: 100, muted: false };
  players.push(p);
  const [input, muteBtn, vol, clearBtn] = cell.querySelectorAll(".bar > *");

  input.addEventListener("change", () => {
    const id = videoId(input.value);
    if (id) setSlot(i, id);
    input.value = "";
  });
  muteBtn.addEventListener("click", () => {
    p.muted = !p.muted;
    command(p, p.muted ? "mute" : "unMute");
    muteBtn.textContent = p.muted ? "🔇" : "🔊";
  });
  vol.addEventListener("input", () => { p.volume = +vol.value; command(p, "setVolume", [p.volume]); });
  clearBtn.addEventListener("click", () => setSlot(i, ""));
}

async function setSlot(i, id) {
  const { slots = ["", "", "", ""] } = await chrome.storage.local.get("slots");
  slots[i] = id;
  await chrome.storage.local.set({ slots });
}

function load(slots) { players.forEach((p, i) => render(p, slots[i] || "")); }
chrome.storage.local.get({ slots: ["", "", "", ""] }, ({ slots }) => load(slots));
chrome.storage.onChanged.addListener((c) => { if (c.slots) load(c.slots.newValue); });

document.getElementById("playAll").addEventListener("click", () => players.forEach((p) => command(p, "playVideo")));
document.getElementById("pauseAll").addEventListener("click", () => players.forEach((p) => command(p, "pauseVideo")));
const toggle = document.getElementById("toggleBars");
toggle.addEventListener("click", () => {
  const hide = toggle.textContent === "Скрыть панели";
  document.querySelectorAll(".bar").forEach((b) => (b.style.display = hide ? "none" : ""));
  toggle.textContent = hide ? "Показать панели" : "Скрыть панели";
});
