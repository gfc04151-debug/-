const enabledBox = document.getElementById("enabled");
const volume = document.getElementById("volume");
const volText = document.getElementById("volText");
const volBox = document.getElementById("volBox");

chrome.storage.local.get({ enabled: true }, ({ enabled }) => { enabledBox.checked = enabled; });
enabledBox.addEventListener("change", () => chrome.storage.local.set({ enabled: enabledBox.checked }));

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/youtube\.com/.test(tab.url || "")) { volBox.classList.add("disabled"); return; }
  chrome.tabs.sendMessage(tab.id, { type: "getState" }, { frameId: 0 }, (res) => {
    if (chrome.runtime.lastError || !res) { volBox.classList.add("disabled"); return; }
    volume.value = Math.round(res.volume * 100);
    volText.textContent = volume.value + "%";
  });
  volume.addEventListener("input", () => {
    volText.textContent = volume.value + "%";
    chrome.tabs.sendMessage(tab.id, { type: "setVolume", volume: volume.value / 100 }, { frameId: 0 });
  });
})();
