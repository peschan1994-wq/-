"use strict";
const $ = (id) => document.getElementById(id);
const STORAGE = "geostudio-project-v1";
const blank = () => ({business: {name: "", category: "", city: "", audience: "", facts: "", contact: ""}, slides: [], analysis: null, analysisInput: {}, task: "", theme: "warm", format: "portrait"});
let state = blank();
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE)); } catch { /* Storage unavailable or reset. */ }
if (saved && typeof saved === "object") {
  const defaults = blank();
  state = {...defaults, ...saved, business: {...defaults.business, ...(saved.business || {})}};
  for (const key of Object.keys(defaults.business)) if (typeof state.business[key] !== "string") state.business[key] = "";
  if (!Array.isArray(state.slides)) state.slides = [];
  state.slides = state.slides.filter(s => s && ["title", "body", "cta", "tag"].every(key => typeof s[key] === "string")).slice(0, 3);
  if (typeof state.task !== "string") state.task = "";
  if (!state.analysisInput || typeof state.analysisInput !== "object") state.analysisInput = {};
  if (!state.analysis || !Array.isArray(state.analysis.items)) state.analysis = null;
}
let selectedSlide = 0;
let photo = null;
let toastTimer;
let taskAnswer = "";
const themes = {
  warm: {bg: "#eee2cc", ink: "#2d3730", accent: "#cc613f", soft: "#dccbac", light: "#f5eddf"},
  forest: {bg: "#2d4739", ink: "#f3ecdc", accent: "#d4b783", soft: "#44644c", light: "#ebdfc6"},
  night: {bg: "#232b42", ink: "#efeee9", accent: "#b9b4f2", soft: "#36425e", light: "#eee7fa"}
};

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").hidden = true, 4000);
}
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  catch { toast("Не удалось сохранить в браузере. Вы можете скачать результаты."); }
}
function showError(id, message) { $(id).textContent = message || ""; $(id).hidden = !message; }
function navigate(view) {
  if (!["stories", "analysis", "tasks", "business"].includes(view)) view = "stories";
  document.querySelectorAll(".view").forEach(el => el.hidden = el.id !== `view-${view}`);
  document.querySelectorAll(".nav-item").forEach(el => {
    const active = el.dataset.view === view;
    el.classList.toggle("active", active);
    if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
  });
  $("breadcrumb-view").textContent = {stories: "Истории", analysis: "Анализ карточки", tasks: "Мои задания", business: "Мой бизнес"}[view];
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
}
document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => navigate(el.dataset.view)));
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

function fillProfile() {
  for (const [key, value] of Object.entries(state.business)) if ($(`business-${key}`)) $(`business-${key}`).value = value;
  $("quick-name").value = state.business.name;
  $("story-facts").value = state.business.facts;
  $("project-label").textContent = state.business.name || "Мой бизнес";
  $("story-theme").value = themes[state.theme] ? state.theme : "warm";
  $("story-format").value = state.format === "square" ? "square" : "portrait";
  $("task-input").value = state.task;
}
$("business-form").addEventListener("submit", e => {
  e.preventDefault();
  for (const key of Object.keys(state.business)) state.business[key] = $(`business-${key}`).value.trim();
  persist(); fillProfile(); toast("Профиль сохранён");
});
$("quick-name").addEventListener("input", e => {
  state.business.name = e.target.value;
  $("business-name").value = e.target.value;
  $("project-label").textContent = e.target.value || "Мой бизнес";
  persist(); drawStory();
});
$("story-facts").addEventListener("input", e => {
  state.business.facts = e.target.value;
  $("business-facts").value = e.target.value;
  persist();
});
$("clear-project").addEventListener("click", () => {
  if (!confirm("Удалить профиль, истории, данные анализа и задание из этого браузера?")) return;
  state = blank(); selectedSlide = 0; photo = null; taskAnswer = "";
  persist(); fillProfile(); renderSlides();
  $("analysis-form").reset(); $("story-form").reset(); fillProfile();
  $("analysis-empty").hidden = false; $("analysis-result").hidden = true;
  $("task-result").textContent = "Здесь появится ответ на ваше задание.";
  $("copy-task").hidden = true; $("photo-label").textContent = "JPG, PNG, WebP · до 8 МБ";
  $("remove-photo").hidden = true; updateOffer();
  ["story-error", "analysis-error", "task-error"].forEach(id => showError(id, ""));
  toast("Сохранённые данные удалены");
});

async function api(path, data) {
  let response;
  try { response = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)}); }
  catch { throw new Error("Сервер недоступен. Проверьте подключение и повторите."); }
  let result;
  try { result = await response.json(); } catch { throw new Error("Сервер вернул неожиданный ответ."); }
  if (!response.ok) throw new Error(result.error || "Не удалось выполнить запрос.");
  return result;
}
function updateOffer() {
  const offer = $("story-goal").value === "offer";
  $("offer-field").hidden = !offer; $("story-offer").required = offer;
  $("story-facts").required = $("story-goal").value === "service";
}
$("story-goal").addEventListener("change", updateOffer);
$("story-form").addEventListener("submit", async e => {
  e.preventDefault(); showError("story-error", "");
  $("generate-button").disabled = true;
  state.business.name = $("quick-name").value.trim();
  state.business.facts = $("story-facts").value.trim();
  try {
    const result = await api("/api/stories", {business: state.business, platform: $("story-platform").value, goal: $("story-goal").value, offer: $("story-offer").value, cta: $("story-cta").value});
    state.slides = result.slides; selectedSlide = 0; persist(); renderSlides(); toast("Три истории готовы. Отредактируйте и скачайте каждую.");
  } catch (error) { showError("story-error", error.message); }
  finally { $("generate-button").disabled = false; }
});
["story-theme", "story-format"].forEach(id => $(id).addEventListener("change", () => {
  state.theme = $("story-theme").value; state.format = $("story-format").value; persist(); drawStory();
}));
$("story-photo").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
    toast("Выберите JPG, PNG или WebP размером до 8 МБ"); e.target.value = ""; return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    if (photo) photo.close(); photo = bitmap;
    $("photo-label").textContent = file.name; $("remove-photo").hidden = false; drawStory();
  } catch { toast("Не удалось прочитать изображение"); }
});
$("remove-photo").addEventListener("click", () => {
  if (photo) photo.close(); photo = null; $("story-photo").value = "";
  $("photo-label").textContent = "JPG, PNG, WebP · до 8 МБ"; $("remove-photo").hidden = true; drawStory();
});

function renderSlides() {
  $("slide-tabs").replaceChildren();
  state.slides.forEach((slide, index) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `История ${index + 1}`;
    button.classList.toggle("active", index === selectedSlide); button.setAttribute("aria-pressed", index === selectedSlide ? "true" : "false");
    button.addEventListener("click", () => { selectedSlide = index; renderSlides(); }); $("slide-tabs").append(button);
  });
  $("slide-editor").hidden = !state.slides.length;
  if (state.slides.length) for (const key of ["title", "body", "cta"]) $(`slide-${key}`).value = state.slides[selectedSlide][key];
  drawStory();
}
for (const key of ["title", "body", "cta"]) $(`slide-${key}`).addEventListener("input", e => {
  if (!state.slides.length) return;
  state.slides[selectedSlide][key] = e.target.value; persist(); drawStory();
});

// Wrap arbitrary text, including long unbroken names, and report truncation.
function linesFor(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      if (ctx.measureText(word).width <= width) { line = word; continue; }
      for (const letter of word) {
        if (line && ctx.measureText(line + letter).width > width) { lines.push(line); line = ""; }
        line += letter;
      }
    }
    lines.push(line);
  }
  return lines;
}
function drawText(ctx, text, x, y, width, font, lineHeight, maxLines) {
  ctx.font = font;
  const lines = linesFor(ctx, text, width); const clipped = lines.length > maxLines;
  const visible = lines.slice(0, maxLines);
  if (clipped && visible.length) {
    let last = visible.at(-1);
    while (last && ctx.measureText(last + "…").width > width) last = last.slice(0, -1);
    visible[visible.length - 1] = last + "…";
  }
  visible.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return {height: visible.length * lineHeight, clipped};
}
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
function drawStory() {
  const canvas = $("story-canvas"); const square = state.format === "square";
  const W = 1080, H = square ? 1080 : 1920; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); const theme = themes[state.theme] || themes.warm;
  const slide = state.slides[selectedSlide] || {title: "Ваш бизнес.\nВаша история.", body: "Расскажите о том, что делаете с заботой о клиентах.", tag: "МЕСТО ДЛЯ ВАШЕЙ ИДЕИ", cta: "Начните с первой истории"};
  ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = theme.soft; ctx.beginPath(); ctx.arc(1020, square ? 200 : 530, square ? 310 : 480, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = .35; ctx.beginPath(); ctx.arc(80, H - 80, 250, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = theme.accent; rounded(ctx, 78, 78, 62, 62, 18);
  ctx.fillStyle = theme.bg; ctx.font = "bold 40px Arial"; ctx.textBaseline = "middle"; ctx.fillText("G", 94, 110);
  ctx.fillStyle = theme.ink; ctx.textBaseline = "top";
  const brand = drawText(ctx, state.business.name || "ВАШ БИЗНЕС", 160, 96, 680, "28px Arial", 34, 1);
  ctx.font = "23px Arial"; ctx.fillText(`${String(selectedSlide + 1).padStart(2, "0")} / 03`, 850, 102);
  let y = square ? 200 : 270;
  let cropWarning = brand.clipped;
  if (photo) {
    const px = 78, py = y, pw = 924, ph = square ? 260 : 660;
    ctx.save(); ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 35); ctx.clip();
    const scale = Math.max(pw / photo.width, ph / photo.height);
    ctx.drawImage(photo, px + (pw - photo.width * scale) / 2, py + (ph - photo.height * scale) / 2, photo.width * scale, photo.height * scale);
    ctx.restore(); y += ph + 50;
  } else if (!square) {
    // Abstract local-business artwork, with no invented product photographs.
    ctx.save(); ctx.translate(200, 310); ctx.rotate(-.10);
    ctx.fillStyle = theme.light; rounded(ctx, 50, 30, 530, 400, 32);
    ctx.fillStyle = theme.accent; rounded(ctx, 85, 85, 460, 62, 15);
    ctx.fillStyle = theme.soft; rounded(ctx, 85, 185, 170, 200, 15); rounded(ctx, 285, 185, 260, 200, 15);
    ctx.fillStyle = theme.bg; ctx.beginPath(); ctx.arc(415, 285, 65, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(390, 307); ctx.lineTo(442, 255); ctx.moveTo(404, 255); ctx.lineTo(442, 255); ctx.lineTo(442, 293); ctx.stroke(); ctx.restore(); y = 860;
  }
  ctx.fillStyle = theme.accent; drawText(ctx, slide.tag, 78, y, 924, "bold 23px Arial", 30, 1); y += square ? 47 : 65;
  ctx.fillStyle = theme.ink;
  const titleSize = square ? (photo ? 54 : 76) : 84;
  const maxTitleLines = square ? (photo ? 2 : 3) : 3;
  const title = drawText(ctx, slide.title, 78, y, 924, `bold ${titleSize}px Arial`, titleSize * 1.12, maxTitleLines);
  cropWarning ||= title.clipped; y += title.height + (square ? 28 : 42);
  const bottom = H - 240; const bodySize = square ? 31 : 42; const lineHeight = bodySize * 1.4;
  const body = drawText(ctx, slide.body, 78, y, 924, `${bodySize}px Arial`, lineHeight, Math.max(1, Math.floor((bottom - y) / lineHeight)));
  cropWarning ||= body.clipped;
  ctx.fillStyle = theme.accent; rounded(ctx, 78, H - 170, 924, 92, 23);
  ctx.fillStyle = theme.bg; const cta = drawText(ctx, slide.cta, 112, H - 145, 790, "bold 29px Arial", 38, 1); cropWarning ||= cta.clipped;
  ctx.strokeStyle = theme.bg; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(931, H - 112); ctx.lineTo(956, H - 137); ctx.moveTo(937, H - 137); ctx.lineTo(956, H - 137); ctx.lineTo(956, H - 118); ctx.stroke();
  $("canvas-warning").hidden = !cropWarning;
}
$("download-png").addEventListener("click", () => {
  const anchor = document.createElement("a"); anchor.href = $("story-canvas").toDataURL("image/png");
  anchor.download = `geostudio-story-${selectedSlide + 1}-${state.format}.png`; anchor.click(); toast("Изображение сохранено");
});
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Текст скопирован"); }
  catch {
    const box = document.createElement("textarea"); box.value = text; document.body.append(box); box.select();
    const success = document.execCommand("copy"); box.remove(); toast(success ? "Текст скопирован" : "Не удалось скопировать. Выделите текст вручную.");
  }
}
$("copy-story").addEventListener("click", () => {
  const s = state.slides[selectedSlide]; if (s) copyText(`${s.title}\n\n${s.body}\n\n${s.cta}`);
});

const analysisFields = ["platform", "url", "name", "category", "address", "phone", "hours", "description", "services", "photos", "rating", "reviews", "unanswered"];
const numericFields = new Set(["photos", "rating", "reviews", "unanswered"]);
function readAnalysis() {
  return Object.fromEntries(analysisFields.map(key => [key, numericFields.has(key) ? ($(`analysis-${key}`).value === "" ? null : Number($(`analysis-${key}`).value)) : $(`analysis-${key}`).value.trim()]));
}
$("analysis-form").addEventListener("input", () => { state.analysisInput = readAnalysis(); persist(); });
$("analysis-platform").addEventListener("change", () => {
  $("analysis-url").placeholder = $("analysis-platform").value === "yandex" ? "https://yandex.ru/maps/…" : "https://2gis.ru/…";
  state.analysisInput = readAnalysis(); persist();
});
$("analysis-form").addEventListener("submit", async e => {
  e.preventDefault(); showError("analysis-error", ""); const button = e.target.querySelector("[type=submit]"); button.disabled = true;
  try { state.analysisInput = readAnalysis(); state.analysis = await api("/api/analyze", state.analysisInput); persist(); renderAnalysis(state.analysis); }
  catch (error) { showError("analysis-error", error.message); }
  finally { button.disabled = false; }
});
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function renderAnalysis(result) {
  const root = $("analysis-result"); root.replaceChildren(); root.hidden = false; $("analysis-empty").hidden = true;
  const score = node("div", null, "panel score-panel"); score.append(node("div", result.platform, "eyebrow"));
  const value = node("div", String(result.score), "score-value"); value.append(node("small", " / 100")); score.append(value, node("p", "Заполнение по чек-листу GeoStudio", "score-caption"), node("p", `Проверено пунктов: ${result.checked}. Нет данных: ${result.unknown}.`, "form-note")); root.append(score);
  const panel = node("div", null, "panel"); panel.append(node("h2", "Что улучшить в первую очередь"));
  if (result.priorities.length) { const list = node("ol", null, "priorities"); result.priorities.forEach(item => list.append(node("li", item.detail))); panel.append(list); }
  else panel.append(node("p", "Все оценённые пункты заполнены. Проверьте актуальность данных и дополните неизвестные пункты.", "muted"));
  panel.append(node("h2", "Все пункты", "result-heading"));
  result.items.forEach(item => {
    const row = node("div", null, "check-item"); const info = node("div"); info.append(node("strong", item.title), node("p", item.detail));
    row.append(node("span", {ok: "✓", action: "!", unknown: "?"}[item.status] || "?", `check-mark ${item.status}`), info); panel.append(row);
  });
  panel.append(node("p", result.note, "report-note"));
  const download = node("button", "Скачать отчёт ↓", "secondary"); download.type = "button";
  download.addEventListener("click", () => {
    const text = [`Анализ: ${result.platform}`, result.source ? `Источник: ${result.source}` : "Источник: введённые вручную данные", `Чек-лист: ${result.score}/100; проверено ${result.checked}; нет данных ${result.unknown}`, "", ...result.items.map(item => `${item.title} — ${item.status === "ok" ? "заполнено" : item.status === "action" ? "нужно проверить" : "нет данных"}\n${item.detail}`), "", result.note].join("\n\n");
    const url = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"})); const a = document.createElement("a"); a.href = url; a.download = "geostudio-card-report.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  panel.append(download); root.append(panel);
}

document.querySelectorAll("[data-task]").forEach(el => el.addEventListener("click", () => { $("task-input").value = el.dataset.task; state.task = el.dataset.task; persist(); $("task-input").focus(); }));
$("task-input").addEventListener("input", e => { state.task = e.target.value; persist(); });
$("save-task").addEventListener("click", () => { state.task = $("task-input").value; persist(); toast("Черновик задания сохранён в браузере"); });
$("task-form").addEventListener("submit", async e => {
  e.preventDefault(); showError("task-error", "");
  if (!state.business.name.trim()) { showError("task-error", "Сначала укажите название в разделе «Мой бизнес»."); return; }
  $("task-submit").disabled = true; $("task-submit").textContent = "Готовим ответ…";
  try {
    const result = await api("/api/task", {business: state.business, task: $("task-input").value});
    taskAnswer = result.text; $("task-result").textContent = taskAnswer; $("copy-task").hidden = false;
  } catch (error) { showError("task-error", error.message); }
  finally { $("task-submit").disabled = false; $("task-submit").textContent = "Выполнить задание ›"; }
});
$("copy-task").addEventListener("click", () => copyText(taskAnswer));
async function checkHealth() {
  try {
    const response = await fetch("/api/health"); if (!response.ok) throw new Error(); const health = await response.json();
    $("ai-status").textContent = health.ai_enabled ? "Ключ ИИ задан · отправьте задание для проверки доступа" : "ИИ не подключён · истории и анализ по чек-листу доступны без ключа";
    $("ai-status").classList.toggle("connected", health.ai_enabled);
  } catch { $("ai-status").textContent = "Сервер недоступен. Перезапустите приложение и обновите страницу."; }
}
fillProfile(); updateOffer();
for (const key of analysisFields) if (state.analysisInput[key] != null) $(`analysis-${key}`).value = state.analysisInput[key];
renderSlides(); if (state.analysis) renderAnalysis(state.analysis);
navigate(location.hash.slice(1)); checkHealth();
