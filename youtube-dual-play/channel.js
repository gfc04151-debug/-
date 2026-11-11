// Поиск самых популярных роликов канала за выбранный период.
// Используется фоновым скриптом (background.js) по запросу мультиэкрана.

// Достаём ytInitialData со страницы канала (компьютерная и мобильная версия).
function extractInitialData(html) {
  let m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (m) return JSON.parse(m[1]);
  m = html.match(/ytInitialData\s*=\s*'((?:[^'\\]|\\[\s\S])*)'/);
  if (!m) return null;
  const s = m[1].replace(/\\x([0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\([\s\S])/g, (_, x, u, c) =>
    x ? String.fromCharCode(parseInt(x, 16)) : u ? String.fromCharCode(parseInt(u, 16))
      : ({ n: "\n", r: "\r", t: "\t" })[c] || c);
  return JSON.parse(s);
}

// Все строки внутри объекта (simpleText, runs[].text, content...).
function textsOf(obj, out = []) {
  if (typeof obj === "string") out.push(obj);
  else if (Array.isArray(obj)) obj.forEach((x) => textsOf(x, out));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(navigationEndpoint|onTap|commandRunTriggers|menu|thumbnail|image|accessibility|trackingParams|loggingDirectives)$/i.test(k)) continue;
      textsOf(v, out);
    }
  }
  return out;
}

const AGO_RE = /(\d+|an?|один|одна|одну)?\s*(?<![a-zа-яё])(seconds?|minutes?|hours?|days?|weeks?|months?|years?|mo|[ywdhms]|секунд[а-яё]*|минут[а-яё]*|мин\.?|час[а-яё]*|ч\.?|дн[а-яё]*\.?|день|недел[а-яё]*|нед\.?|месяц[а-яё]*|мес\.?|год[а-яё]*|г\.?|лет)\s+(ago|назад)/i;
const UNIT_DAYS = [
  [/^(mo|month|мес)/i, 30], [/^(s|m|h|секунд|минут|мин|час|ч)/i, 0], [/^(d|дн|день)/i, 1],
  [/^(w|недел|нед)/i, 7], [/^(y|год|г|лет)/i, 365],
];
function parseAge(text) {
  const m = AGO_RE.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1] || "") ? +m[1] : 1;
  const u = UNIT_DAYS.find(([re]) => re.test(m[2]));
  return u ? n * u[1] : null;
}
// «1.2M views», «12K views», «1,234 views», «1,2 млн просмотров», «12 тыс. просмотров».
function parseViews(text) {
  const m = /([\d][\d.,\s]*)\s*(K|M|B|thousand|million|billion|тыс\.?|млн|млрд)?\s*(views?|просмотр[а-яё]*)/i.exec(text);
  if (!m) return /no views|нет просмотров/i.test(text) ? 0 : null;
  let num = m[1].trim();
  const mult = { k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9, "тыс": 1e3, "тыс.": 1e3, "млн": 1e6, "млрд": 1e9 }[(m[2] || "").toLowerCase()] || 1;
  num = mult > 1 ? num.replace(/\s/g, "").replace(",", ".") : num.replace(/[\s.,]/g, "");
  return Math.round(parseFloat(num) * mult);
}
function parseDuration(text) {
  const m = /(?:^|\s)(\d{1,2}(?::\d{2}){1,2})(?:\s|$)/.exec(text);
  return m ? m[1].split(":").reduce((s, n) => s * 60 + +n, 0) : null;
}

// Находим все карточки видео в данных страницы.
function collectVideos(data) {
  const found = new Map();
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    const id = typeof o.videoId === "string" ? o.videoId
      : (o.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && o.contentId) || null;
    if (id && /^[\w-]{11}$/.test(id) && !found.has(id)) {
      const all = textsOf(o);
      const joined = all.join("  ");
      const views = all.map(parseViews).find((v) => v !== null);
      const age = all.map(parseAge).find((v) => v !== null);
      if (views != null && age != null) {
        found.set(id, {
          id, views, ageDays: age,
          seconds: all.map(parseDuration).find((v) => v !== null) ?? null,
          title: textsOf(o.title || (o.metadata && o.metadata.lockupMetadataViewModel &&
            o.metadata.lockupMetadataViewModel.title) || [])[0] || all.find((t) => t.length > 15) || id,
          isShort: /\/shorts\//.test(JSON.stringify(o.navigationEndpoint || {})) || /SHORTS/.test(joined),
        });
        return;
      }
    }
    Object.values(o).forEach(walk);
  })(data);
  return [...found.values()];
}

// Ссылка на канал → адрес вкладки «Видео».
function channelVideosUrl(input) {
  input = (input || "").trim();
  if (/^@[\w.\-]+$/.test(input)) return `https://www.youtube.com/${input}/videos?hl=en`;
  let u;
  try { u = new URL(/^https?:/.test(input) ? input : "https://" + input); } catch (_) { return null; }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(@[^/]+|channel\/[\w-]+|c\/[^/]+|user\/[^/]+)/);
  return m ? `https://www.youtube.com/${m[1]}/videos?hl=en` : null;
}

async function topChannelVideos(input, maxDays, minSeconds, count = 4) {
  const url = channelVideosUrl(input);
  if (!url) throw new Error("Не похоже на ссылку на канал. Пример: https://www.youtube.com/@MrBeast");
  // Без cookie: так YouTube не сменит язык вашего аккаунта из-за hl=en.
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error("YouTube не открыл канал (код " + res.status + ")");
  const data = extractInitialData(await res.text());
  if (!data) throw new Error("Не удалось прочитать страницу канала");
  const all = collectVideos(data).filter((v) => !v.isShort);
  const fresh = all.filter((v) => v.ageDays < maxDays);
  const longEnough = fresh.filter((v) => !minSeconds || v.seconds == null || v.seconds >= minSeconds);
  const byViews = (a, b) => b.views - a.views;
  const pick = (longEnough.length ? longEnough : fresh).sort(byViews).slice(0, count);
  // Если за период роликов меньше 4 — добавляем самые популярные из более старых.
  const extra = all.filter((v) => !pick.includes(v)).sort(byViews).slice(0, count - pick.length);
  return { videos: pick, extra, scanned: all.length };
}

if (typeof module !== "undefined") module.exports = { extractInitialData, collectVideos, topChannelVideos, channelVideosUrl, parseViews, parseAge };
