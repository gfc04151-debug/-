const $ = (id) => document.getElementById(id);
const MULTI_URL = chrome.runtime.getURL("multiview.html");

const modeInputs = document.querySelectorAll('input[name="mode"]');
chrome.storage.local.get({ enabled: true, mode: "mix" }, ({ enabled, mode }) => {
  $("enabled").checked = enabled;
  modeInputs.forEach((r) => { r.checked = r.value === mode; });
});
$("enabled").addEventListener("change", () => chrome.storage.local.set({ enabled: $("enabled").checked }));
modeInputs.forEach((r) => r.addEventListener("change", () => {
  chrome.storage.local.set({ mode: r.value });
  if (r.value === "mix") $("status").textContent = "Коснитесь один раз каждой вкладки YouTube, чтобы в ней включился звук.";
}));

async function openMulti() {
  const tabs = await chrome.tabs.query({ url: MULTI_URL });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url: MULTI_URL });
  }
  window.close();
}
$("openMulti").addEventListener("click", openMulti);

// Достаём ID видео из любой ссылки YouTube.
function videoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch (_) { return null; }
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = tab && videoId(tab.url || "");
  if (id) {
    $("addBox").classList.remove("hidden");
    document.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", async () => {
      const { slots = ["", "", "", ""] } = await chrome.storage.local.get("slots");
      slots[+b.dataset.slot] = id;
      await chrome.storage.local.set({ slots });
      // Видео в этой вкладке останавливаем, чтобы звук не дублировался.
      chrome.tabs.sendMessage(tab.id, { type: "pauseVideo" }, { frameId: 0 }, () => void chrome.runtime.lastError);
      $("status").textContent = `Добавлено в окно ${+b.dataset.slot + 1}.`;
    }));
  }

  if (!tab || !/youtube\.com/.test(tab.url || "")) { $("volBox").classList.add("disabled"); return; }
  chrome.tabs.sendMessage(tab.id, { type: "getState" }, { frameId: 0 }, (res) => {
    if (chrome.runtime.lastError || !res) { $("volBox").classList.add("disabled"); return; }
    $("volume").value = Math.round(res.volume * 100);
    $("volText").textContent = $("volume").value + "%";
  });
  $("volume").addEventListener("input", () => {
    $("volText").textContent = $("volume").value + "%";
    chrome.tabs.sendMessage(tab.id, { type: "setVolume", volume: $("volume").value / 100 }, { frameId: 0 });
  });
})();
