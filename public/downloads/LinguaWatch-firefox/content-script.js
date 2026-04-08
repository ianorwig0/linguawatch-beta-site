/* global browser */

const LESSON_MIN_MS = 5 * 60 * 1000;
const LESSON_MAX_MS = 10 * 60 * 1000;
const MIN_PHRASE_WORDS = 6;
const MAX_BUFFER_SIZE = 30;

const DEFAULT_LESSON_FREQUENCY_MINUTES = Math.round((LESSON_MIN_MS + LESSON_MAX_MS) / 2 / 60000);

const SUBTITLE_SELECTORS = [".ytp-caption-segment", ".captions-text", "[class*='caption']"];

const VERB_INDICATORS = [
  "to",
  "is",
  "are",
  "was",
  "were",
  "will",
  "would",
  "could",
  "should",
  "have",
  "has",
  "had",
];

let subtitleBuffer = [];
let lastPushedSubtitle = "";
let lastPickedPhrase = "";
let lessonTimerId = null;
let startDelayTimerId = null;
let subtitlePollId = null;
let lessonInProgress = false;
let progressFinishHandler = null;
let lessonCancel = null;
let currentSettings = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: DEFAULT_LESSON_FREQUENCY_MINUTES,
  targetLanguage: "es",
};

function countWords(s) {
  if (!s || typeof s !== "string") return 0;
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function cleanSubtitleText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let t = raw;

  t = t.replace(/\[[^\]]*\]/g, " ");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/^\s*[-–—]+\s*/g, " ");
  t = t.replace(/\s*[-–—]+\s*$/g, " ");
  t = t.replace(/\s*[-–]{2,}\s*/g, " ");
  t = t.replace(/\s*[–—]\s*/g, " ");

  const parts = t.split(/([.!?]+)/);
  const sentences = [];
  let buf = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^[.!?]+$/.test(p)) {
      const sent = (buf + p).trim();
      buf = "";
      if (sent) sentences.push(sent);
    } else {
      buf += p;
    }
  }
  if (buf.trim()) sentences.push(buf.trim());

  const seen = Object.create(null);
  const unique = [];
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (seen[key]) continue;
    seen[key] = true;
    unique.push(s);
  }

  t = unique.join(". ");
  if (t.length && !/[.!?]$/.test(t)) t += ".";

  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function getSubtitleTextFromDom() {
  for (let i = 0; i < SUBTITLE_SELECTORS.length; i++) {
    const sel = SUBTITLE_SELECTORS[i];
    const nodes = document.querySelectorAll(sel);
    if (nodes.length) {
      const texts = [];
      for (let j = 0; j < nodes.length; j++) {
        const txt = (nodes[j].textContent || "").trim();
        if (txt) texts.push(txt);
      }
      if (texts.length) return texts.join(" ");
    }
  }
  return "";
}

function phraseHasVerbIndicator(phrase) {
  const lower = phrase.toLowerCase();
  for (let i = 0; i < VERB_INDICATORS.length; i++) {
    const w = VERB_INDICATORS[i];
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    if (re.test(lower)) return true;
  }
  return false;
}

function selectBestPhrase() {
  const candidates = subtitleBuffer.filter(function (p) {
    return countWords(p) >= MIN_PHRASE_WORDS;
  });

  const filtered = candidates.filter(function (p) {
    if (p === lastPickedPhrase) return false;
    let occ = 0;
    for (let i = 0; i < subtitleBuffer.length; i++) {
      if (subtitleBuffer[i] === p) occ++;
    }
    if (occ > 2) return false;
    return true;
  });

  if (!filtered.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < filtered.length; i++) {
    const phrase = filtered[i];
    const wc = countWords(phrase);
    let occ = 0;
    for (let j = 0; j < subtitleBuffer.length; j++) {
      if (subtitleBuffer[j] === phrase) occ++;
    }
    const extra = Math.max(0, occ - 1);
    let score = Math.min(wc, 14) - 2 * extra;
    if (phraseHasVerbIndicator(phrase)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = phrase;
    } else if (score === bestScore && best !== null) {
      if (wc > countWords(best)) best = phrase;
    }
  }

  return best;
}

async function loadSettings() {
  try {
    const s = await browser.storage.sync.get({
      globalEnabled: true,
      disabledHosts: [],
      lessonFrequencyMinutes: DEFAULT_LESSON_FREQUENCY_MINUTES,
      targetLanguage: "es",
    });
    currentSettings = {
      globalEnabled: s.globalEnabled !== false,
      disabledHosts: Array.isArray(s.disabledHosts) ? s.disabledHosts : [],
      lessonFrequencyMinutes: Math.max(5, Math.min(15, Number(s.lessonFrequencyMinutes) || DEFAULT_LESSON_FREQUENCY_MINUTES)),
      targetLanguage: typeof s.targetLanguage === "string" && s.targetLanguage ? s.targetLanguage : "es",
    };
  } catch (e) {
    console.error("[LinguaWatch] loadSettings", e);
  }
}

function isActiveOnThisPage() {
  const host = window.location.hostname;
  if (!currentSettings.globalEnabled) return false;
  if (currentSettings.disabledHosts.indexOf(host) !== -1) return false;
  return true;
}

function getLessonDelayRangeMs() {
  const n = currentSettings.lessonFrequencyMinutes;
  const minM = n;
  const maxM = Math.min(n + 5, 15);
  const minMs = minM * 60 * 1000;
  const maxMs = maxM * 60 * 1000;
  if (maxMs <= minMs) return { minMs: minMs, maxMs: minMs + 1000 };
  return { minMs, maxMs };
}

function clearLessonTimer() {
  if (lessonTimerId !== null) {
    clearTimeout(lessonTimerId);
    lessonTimerId = null;
  }
}

function scheduleNextLesson() {
  clearLessonTimer();
  if (!isActiveOnThisPage()) return;

  const range = getLessonDelayRangeMs();
  const span = range.maxMs - range.minMs;
  const delay = range.minMs + Math.random() * span;

  lessonTimerId = window.setTimeout(function () {
    lessonTimerId = null;
    triggerLesson();
  }, delay);
}

function removeOverlay() {
  const root = document.getElementById("lw-overlay");
  if (root && root.parentNode) {
    if (progressFinishHandler) {
      const bar = root.querySelector("#lw-progress-bar");
      if (bar) bar.removeEventListener("animationend", progressFinishHandler);
      progressFinishHandler = null;
    }
    root.parentNode.removeChild(root);
  }
}

function getOverlayMountParent() {
  const fs = document.fullscreenElement;
  if (fs && fs.nodeType === 1) return fs;
  return document.body;
}

function showError(message) {
  const text = typeof message === "string" ? message : String(message);
  let el = document.getElementById("lw-global-error");
  if (!el) {
    el = document.createElement("div");
    el.id = "lw-global-error";
    el.setAttribute(
      "style",
      [
        "position:fixed",
        "top:12px",
        "left:12px",
        "z-index:999999",
        "background:#b91c1c",
        "color:#ffffff",
        "padding:12px",
        "max-width:80vw",
        "font-family:system-ui,sans-serif",
        "font-size:14px",
        "line-height:1.4",
        "border-radius:8px",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
      ].join(";")
    );
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  window.setTimeout(function () {
    if (el && el.parentNode) {
      el.style.display = "none";
    }
  }, 8000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function playAudioBase64(b64) {
  return new Promise(function (resolve, reject) {
    if (!b64 || typeof b64 !== "string") {
      reject(new Error("Invalid audio"));
      return;
    }
    const audio = new Audio("data:audio/mpeg;base64," + b64);
    audio.onended = function () {
      resolve();
    };
    audio.onerror = function () {
      reject(new Error("Audio playback error"));
    };
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.catch(function (err) {
        reject(err);
      });
    }
  });
}

function buildOverlayHtmlLoading() {
  return (
    '<div id="lw-overlay" role="dialog" aria-modal="true" aria-labelledby="lw-logo">' +
    '<div id="lw-card">' +
    '<header id="lw-header">' +
    '<h1 id="lw-logo">LinguaWatch</h1>' +
    '<button type="button" id="lw-close" aria-label="Close lesson" title="Close">×</button>' +
    "</header>" +
    '<div id="lw-loading"><div id="lw-spinner" aria-hidden="true"></div><div>Preparing your lesson…</div></div>' +
    "</div></div>"
  );
}

function buildOverlayHtmlContent(data) {
  const en = escapeHtml(data.englishPhrase);
  const tr = escapeHtml(data.translation);
  let chips = "";
  const wb = data.wordBreakdown || [];
  for (let i = 0; i < wb.length && i < 6; i++) {
    const item = wb[i];
    const e = escapeHtml(item.english || "");
    const s = escapeHtml(item.spanish || "");
    chips += '<span class="lw-chip">' + e + " → " + s + "</span>";
  }
  const gram = escapeHtml(data.grammarNote || "");
  const exEs = escapeHtml(data.exampleEs || "");
  const exEn = escapeHtml(data.exampleEn || "");

  return (
    '<div id="lw-overlay" role="dialog" aria-modal="true" aria-labelledby="lw-logo">' +
    '<div id="lw-card">' +
    '<header id="lw-header">' +
    '<h1 id="lw-logo">LinguaWatch</h1>' +
    '<button type="button" id="lw-close" aria-label="Close lesson" title="Close">×</button>' +
    "</header>" +
    '<div id="lw-progress-wrap"><div id="lw-progress-bar"></div></div>' +
    '<div id="lw-main">' +
    '<div id="lw-grid">' +
    "<div>" +
    '<p class="lw-section-label">English phrase</p>' +
    '<p class="lw-text-en" id="lw-en">' +
    en +
    "</p>" +
    '<p class="lw-section-label" style="margin-top:20px">Spanish</p>' +
    '<p class="lw-text-es" id="lw-tr">' +
    tr +
    "</p>" +
    '<p class="lw-section-label" style="margin-top:20px">Word breakdown</p>' +
    '<div id="lw-chips">' +
    chips +
    "</div>" +
    "</div>" +
    "<div>" +
    '<p class="lw-section-label">Grammar rule</p>' +
    '<p class="lw-grammar" id="lw-gram">' +
    gram +
    "</p>" +
    '<p class="lw-section-label" style="margin-top:20px">Example</p>' +
    '<p class="lw-example-block"><span class="lw-example-es" id="lw-ex-es">' +
    exEs +
    '</span><br/><span id="lw-ex-en">' +
    exEn +
    "</span></p>" +
    "</div>" +
    "</div>" +
    '<footer id="lw-footer"><button type="button" id="lw-continue">Continue Watching</button></footer>' +
    "</div>" +
    "</div></div>"
  );
}

function wireOverlayClose(onDone, cancelRef) {
  const root = document.getElementById("lw-overlay");
  if (!root) return;

  function finish() {
    if (cancelRef) cancelRef.cancelled = true;
    removeOverlay();
    const v = document.querySelector("video");
    if (v) {
      try {
        v.play();
      } catch (e) {
        console.warn("[LinguaWatch] video.play", e);
      }
    }
    lessonInProgress = false;
    lessonCancel = null;
    if (typeof onDone === "function") onDone();
  }

  const closeBtn = root.querySelector("#lw-close");
  const contBtn = root.querySelector("#lw-continue");
  if (closeBtn) closeBtn.addEventListener("click", finish);
  if (contBtn) contBtn.addEventListener("click", finish);

  const bar = root.querySelector("#lw-progress-bar");
  if (bar) {
    progressFinishHandler = function (ev) {
      if (ev.animationName === "lw-progress-shrink" || ev.type === "animationend") {
        finish();
      }
    };
    bar.addEventListener("animationend", progressFinishHandler);
  }
}

async function runTtsSequence(translation, wordBreakdown, exampleEs, cancelRef) {
  const speed = 1;
  const sections = [];

  sections.push({ label: "translation", text: translation });

  if (Array.isArray(wordBreakdown) && wordBreakdown.length) {
    const parts = [];
    for (let i = 0; i < wordBreakdown.length && i < 6; i++) {
      const sp = wordBreakdown[i] && wordBreakdown[i].spanish;
      if (sp) parts.push(sp);
    }
    if (parts.length) {
      sections.push({ label: "breakdown", text: parts.join(", ") });
    }
  }

  sections.push({ label: "example", text: exampleEs });

  for (let i = 0; i < sections.length; i++) {
    if (cancelRef && cancelRef.cancelled) return;
    const sec = sections[i];
    if (!sec.text || !String(sec.text).trim()) continue;

    const res = await browser.runtime.sendMessage({
      type: "TTS",
      text: String(sec.text).trim(),
      speed: speed,
    });

    if (cancelRef && cancelRef.cancelled) return;

    if (typeof res === "string" && res.indexOf("TTS failed") === 0) {
      showError(res);
      continue;
    }
    if (typeof res !== "string" || !res.length) {
      showError("TTS failed: empty response");
      continue;
    }

    try {
      await playAudioBase64(res);
    } catch (e) {
      showError("TTS playback failed: " + (e && e.message ? e.message : String(e)));
    }
  }
}

async function triggerLesson() {
  if (lessonInProgress) return;
  if (!isActiveOnThisPage()) {
    scheduleNextLesson();
    return;
  }

  const phrase = selectBestPhrase();
  if (!phrase) {
    scheduleNextLesson();
    return;
  }

  lastPickedPhrase = phrase;
  lessonInProgress = true;
  clearLessonTimer();

  const cancelRef = { cancelled: false };
  lessonCancel = cancelRef;

  const video = document.querySelector("video");
  if (video) {
    try {
      video.pause();
    } catch (e) {
      console.warn("[LinguaWatch] video.pause", e);
    }
  }

  removeOverlay();
  const parent = getOverlayMountParent();
  parent.insertAdjacentHTML("beforeend", buildOverlayHtmlLoading());

  wireOverlayClose(function () {
    scheduleNextLesson();
  }, cancelRef);

  let translateResult;
  try {
    translateResult = await browser.runtime.sendMessage({
      type: "TRANSLATE",
      englishPhrase: phrase,
      targetLanguage: currentSettings.targetLanguage || "es",
    });
  } catch (e) {
    showError("Translation failed: " + (e && e.message ? e.message : String(e)));
    removeOverlay();
    lessonInProgress = false;
    lessonCancel = null;
    scheduleNextLesson();
    return;
  }

  if (cancelRef.cancelled) {
    lessonInProgress = false;
    lessonCancel = null;
    return;
  }

  if (typeof translateResult === "string") {
    showError(translateResult);
    removeOverlay();
    lessonInProgress = false;
    lessonCancel = null;
    scheduleNextLesson();
    return;
  }

  const data = {
    englishPhrase: phrase,
    translation: translateResult.translation,
    wordBreakdown: translateResult.wordBreakdown,
    grammarNote: translateResult.grammarNote,
    exampleEs: translateResult.exampleEs,
    exampleEn: translateResult.exampleEn,
  };

  removeOverlay();
  if (cancelRef.cancelled) {
    lessonInProgress = false;
    lessonCancel = null;
    scheduleNextLesson();
    return;
  }

  parent.insertAdjacentHTML("beforeend", buildOverlayHtmlContent(data));

  wireOverlayClose(function () {
    scheduleNextLesson();
  }, cancelRef);

  try {
    await runTtsSequence(data.translation, data.wordBreakdown, data.exampleEs, cancelRef);
  } catch (e) {
    console.error("[LinguaWatch] TTS sequence", e);
  }

  if (!cancelRef.cancelled) {
    lessonCancel = null;
  }
}

function pollSubtitles() {
  const raw = getSubtitleTextFromDom();
  const cleaned = cleanSubtitleText(raw);
  if (!cleaned) return;

  if (countWords(cleaned) < MIN_PHRASE_WORDS) return;
  if (cleaned === lastPushedSubtitle) return;

  lastPushedSubtitle = cleaned;
  subtitleBuffer.push(cleaned);
  if (subtitleBuffer.length > MAX_BUFFER_SIZE) {
    subtitleBuffer = subtitleBuffer.slice(subtitleBuffer.length - MAX_BUFFER_SIZE);
  }
}

function onStorageChanged(changes, area) {
  if (area !== "sync") return;
  loadSettings().then(function () {
    if (!isActiveOnThisPage()) {
      clearLessonTimer();
    } else if (!lessonInProgress) {
      scheduleNextLesson();
    }
  });
}

function onKeyDown(event) {
  if (event.shiftKey && (event.key === "L" || event.key === "l")) {
    event.preventDefault();
    console.log("[LinguaWatch] Shift+L triggered");
    triggerLesson();
  }
}

async function init() {
  await loadSettings();

  browser.storage.onChanged.addListener(onStorageChanged);

  window.addEventListener("keydown", onKeyDown, true);

  subtitlePollId = window.setInterval(pollSubtitles, 1000);

  startDelayTimerId = window.setTimeout(function () {
    startDelayTimerId = null;
    if (isActiveOnThisPage()) scheduleNextLesson();
  }, 10000);
}

init();
