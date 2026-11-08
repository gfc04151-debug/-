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

// Команды окну (их выполняет inject.js внутри окна YouTube).
function command(p, cmd, value) {
  const f = p.cell.querySelector("iframe");
  if (f && f.contentWindow) f.contentWindow.postMessage({ __ytDual: "mv", cmd, value }, "*");
}

// "full" — полная страница YouTube (ваш аккаунт, история просмотров);
// "embed" — встроенный плеер (легче, но история обычно не сохраняется).
let playerType = "full";

function render(p, id) {
  const box = p.cell.querySelector(".player");
  const key = id && `${playerType}:${id}`;
  if (p.key === key) return;
  p.key = key;
  box.innerHTML = "";
  if (!id) {
    box.innerHTML = '<div class="empty">Вставьте ссылку ниже<br>или добавьте видео из другой вкладки через значок расширения</div>';
    return;
  }
  const f = document.createElement("iframe");
  f.src = playerType === "full"
    ? `https://m.youtube.com/watch?v=${id}&ytdual=1`
    : `https://www.youtube.com/embed/${id}?ytdual=1&playsinline=1&autoplay=1&rel=0`;
  f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  f.allowFullscreen = true;
  f.referrerPolicy = "strict-origin-when-cross-origin";
  f.addEventListener("load", () => command(p, "play"));
  box.appendChild(f);
}

for (let i = 0; i < 4; i++) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.innerHTML = `
    <div class="player"></div>
    <div class="bar">
      <input type="text" placeholder="Ссылка на видео ${i + 1}">
      <button title="Убрать">✕</button>
    </div>`;
  grid.appendChild(cell);
  const p = { cell, key: undefined, volume: 100, muted: false };
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

let currentSlots = ["", "", "", ""];
function load(slots) { currentSlots = slots; players.forEach((p, i) => render(p, slots[i] || "")); }
chrome.storage.local.get({ slots: ["", "", "", ""], mvPlayer: "full" }, ({ slots, mvPlayer }) => {
  playerType = mvPlayer;
  document.getElementById("playerType").value = mvPlayer;
  load(slots);
});
chrome.storage.onChanged.addListener((c) => {
  if (c.mvPlayer) { playerType = c.mvPlayer.newValue; load(currentSlots); }
  if (c.slots) load(c.slots.newValue);
});
document.getElementById("playerType").addEventListener("change", (e) =>
  chrome.storage.local.set({ mvPlayer: e.target.value }));

document.getElementById("playAll").addEventListener("click", () => players.forEach((p) => command(p, "play")));
document.getElementById("pauseAll").addEventListener("click", () => players.forEach((p) => command(p, "pause")));
document.getElementById("login").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F" });
});
document.getElementById("reload").addEventListener("click", () => location.reload());
const toggle = document.getElementById("toggleBars");
toggle.addEventListener("click", () => {
  const hide = toggle.textContent === "Скрыть панели";
  document.querySelectorAll(".bar").forEach((b) => (b.style.display = hide ? "none" : ""));
  toggle.textContent = hide ? "Показать панели" : "Скрыть панели";
});
