/* global browser */

const LESSON_MIN_MS = 5 * 60 * 1000;
const LESSON_MAX_MS = 10 * 60 * 1000;
const MIN_PHRASE_WORDS = 6;
const MAX_BUFFER_SIZE = 30;
const DEFAULT_LESSON_FREQUENCY_MINUTES = Math.round((LESSON_MIN_MS + LESSON_MAX_MS) / 2 / 60000);

const SUBTITLE_SELECTORS = [
  ".ytp-caption-segment",
  ".captions-text",
  ".player-timedtext-text-container",
  ".player-timedtext",
  "[data-uia='player-subtitle']",
  "[class*='subtitle']",
  "[class*='caption']",
  "[aria-live='assertive']",
];

const VERB_INDICATORS = ["to", "is", "are", "was", "were", "will", "would", "could", "should", "have", "has", "had"];

let subtitleBuffer = [];
let lastPushedSubtitle = "";
let lastPickedPhrase = "";
let lessonTimerId = null;
let lessonInProgress = false;
let progressFinishHandler = null;
let currentSettings = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: DEFAULT_LESSON_FREQUENCY_MINUTES,
  lessonDirection: "en_to_es",
  platformEnabled: { youtube: true, netflix: false, max: false },
};

function getPlatformFromHostname(host) {
  if (host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com") return "youtube";
  if (host === "www.netflix.com" || host === "netflix.com") return "netflix";
  if (host === "www.max.com" || host === "max.com" || host === "play.hbomax.com") return "max";
  return null;
}

function isPlatformEnabledForCurrentHost() {
  const platform = getPlatformFromHostname(window.location.hostname);
  return !!(platform && currentSettings.platformEnabled && currentSettings.platformEnabled[platform]);
}

function reportMetricEvent(eventType, payload) {
  browser.runtime.sendMessage({ type: "METRIC_EVENT", eventType, payload: payload || {} }).catch(function () {});
}

function countWords(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function cleanSubtitleText(raw) {
  if (!raw) return "";
  let t = raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*[-–—]+\s*/g, " ")
    .replace(/\s*[-–—]+\s*$/g, " ")
    .replace(/\s*[-–]{2,}\s*/g, " ")
    .replace(/\s*[–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t && !/[.!?]$/.test(t)) t += ".";
  return t;
}

function getSubtitleTextFromDom() {
  for (let i = 0; i < SUBTITLE_SELECTORS.length; i++) {
    const nodes = document.querySelectorAll(SUBTITLE_SELECTORS[i]);
    if (!nodes.length) continue;
    const texts = [];
    for (let j = 0; j < nodes.length; j++) {
      const txt = (nodes[j].textContent || "").trim();
      if (txt) texts.push(txt);
    }
    if (texts.length) return texts.join(" ");
  }
  return "";
}

function phraseHasVerbIndicator(phrase) {
  const lower = phrase.toLowerCase();
  for (let i = 0; i < VERB_INDICATORS.length; i++) {
    const re = new RegExp("\\b" + VERB_INDICATORS[i] + "\\b", "i");
    if (re.test(lower)) return true;
  }
  return false;
}

function selectBestPhrase() {
  const candidates = subtitleBuffer.filter(function (p) {
    return countWords(p) >= MIN_PHRASE_WORDS && p !== lastPickedPhrase;
  });
  if (!candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const phrase = candidates[i];
    const wc = countWords(phrase);
    let score = Math.min(wc, 14);
    if (phraseHasVerbIndicator(phrase)) score += 3;
    if (score > bestScore) {
      best = phrase;
      bestScore = score;
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
      lessonDirection: "en_to_es",
      platformEnabled: { youtube: true, netflix: false, max: false },
    });
    currentSettings = {
      globalEnabled: s.globalEnabled !== false,
      disabledHosts: Array.isArray(s.disabledHosts) ? s.disabledHosts : [],
      lessonFrequencyMinutes: Math.max(5, Math.min(15, Number(s.lessonFrequencyMinutes) || DEFAULT_LESSON_FREQUENCY_MINUTES)),
      lessonDirection: s.lessonDirection === "es_to_en" ? "es_to_en" : "en_to_es",
      platformEnabled: {
        youtube: !s.platformEnabled || s.platformEnabled.youtube !== false,
        netflix: !!(s.platformEnabled && s.platformEnabled.netflix),
        max: !!(s.platformEnabled && s.platformEnabled.max),
      },
    };
  } catch (e) {
    console.error("[LinguaWatch] loadSettings", e);
  }
}

function isActiveOnThisPage() {
  const host = window.location.hostname;
  if (!currentSettings.globalEnabled) return false;
  if (currentSettings.disabledHosts.indexOf(host) !== -1) return false;
  if (!isPlatformEnabledForCurrentHost()) return false;
  return true;
}

function getLessonDelayRangeMs() {
  const n = currentSettings.lessonFrequencyMinutes;
  const minMs = n * 60 * 1000;
  const maxMs = Math.min(n + 5, 15) * 60 * 1000;
  return { minMs, maxMs: maxMs > minMs ? maxMs : minMs + 1000 };
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
  const delay = range.minMs + Math.random() * (range.maxMs - range.minMs);
  lessonTimerId = window.setTimeout(function () {
    lessonTimerId = null;
    triggerLesson();
  }, delay);
}

function removeOverlay() {
  const root = document.getElementById("lw-overlay");
  if (!root || !root.parentNode) return;
  if (progressFinishHandler) {
    const bar = root.querySelector("#lw-progress-bar");
    if (bar) bar.removeEventListener("animationend", progressFinishHandler);
    progressFinishHandler = null;
  }
  root.parentNode.removeChild(root);
}

function getOverlayMountParent() {
  return document.fullscreenElement && document.fullscreenElement.nodeType === 1 ? document.fullscreenElement : document.body;
}

function showError(message) {
  let el = document.getElementById("lw-global-error");
  if (!el) {
    el = document.createElement("div");
    el.id = "lw-global-error";
    el.style.cssText = "position:fixed;top:12px;left:12px;z-index:999999;background:#b91c1c;color:#fff;padding:12px;max-width:80vw;font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.35)";
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = String(message);
  el.style.display = "block";
  window.setTimeout(function () {
    if (el && el.parentNode) el.style.display = "none";
  }, 8000);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildOverlayHtmlLoading() {
  return '<div id="lw-overlay" role="dialog" aria-modal="true" aria-labelledby="lw-logo"><div id="lw-card"><header id="lw-header"><h1 id="lw-logo">LinguaWatch</h1><button type="button" id="lw-close" aria-label="Close lesson" title="Close">×</button></header><div id="lw-loading"><div id="lw-spinner" aria-hidden="true"></div><div>Preparing your lesson…</div></div></div></div>';
}

function getDirectionLabels() {
  if (currentSettings.lessonDirection === "es_to_en") {
    return { sourceLabel: "Spanish phrase", targetLabel: "English", sourceWordLabel: "Spanish", targetWordLabel: "English" };
  }
  return { sourceLabel: "English phrase", targetLabel: "Spanish", sourceWordLabel: "English", targetWordLabel: "Spanish" };
}

function buildOverlayHtmlContent(data) {
  const labels = getDirectionLabels();
  const wb = data.wordBreakdown || [];
  let chips = "";
  for (let i = 0; i < wb.length && i < 6; i++) {
    chips += '<span class="lw-chip">' + escapeHtml(wb[i].sourceText || "") + " → " + escapeHtml(wb[i].targetText || "") + "</span>";
  }
  return (
    '<div id="lw-overlay" role="dialog" aria-modal="true" aria-labelledby="lw-logo"><div id="lw-card"><header id="lw-header"><h1 id="lw-logo">LinguaWatch</h1><button type="button" id="lw-close" aria-label="Close lesson" title="Close">×</button></header><div id="lw-progress-wrap"><div id="lw-progress-bar"></div></div><div id="lw-main"><div id="lw-grid"><div><p class="lw-section-label">' +
    escapeHtml(labels.sourceLabel) +
    '</p><p class="lw-text-en" id="lw-en">' +
    escapeHtml(data.sourcePhrase) +
    '</p><p class="lw-section-label" style="margin-top:20px">' +
    escapeHtml(labels.targetLabel) +
    '</p><p class="lw-text-es" id="lw-tr">' +
    escapeHtml(data.translation) +
    '</p><p class="lw-section-label" style="margin-top:20px">Word breakdown (' +
    escapeHtml(labels.sourceWordLabel) +
    " → " +
    escapeHtml(labels.targetWordLabel) +
    ')</p><div id="lw-chips">' +
    chips +
    '</div></div><div><p class="lw-section-label">Grammar rule</p><p class="lw-grammar" id="lw-gram">' +
    escapeHtml(data.grammarNote || "") +
    '</p><p class="lw-section-label" style="margin-top:20px">Example</p><p class="lw-example-block"><span class="lw-example-es" id="lw-ex-es">' +
    escapeHtml(data.exampleSource || "") +
    '</span><br/><span id="lw-ex-en">' +
    escapeHtml(data.exampleTarget || "") +
    '</span></p></div></div><footer id="lw-footer"><button type="button" id="lw-continue">Continue Watching</button><button type="button" id="lw-report-bad" class="lw-link-btn">Report bad translation</button></footer></div></div></div>'
  );
}

function wireOverlayClose(onDone, cancelRef, reportFeedback) {
  const root = document.getElementById("lw-overlay");
  if (!root) return;
  function finish() {
    if (cancelRef) cancelRef.cancelled = true;
    removeOverlay();
    const v = document.querySelector("video");
    if (v) v.play().catch(function () {});
    lessonInProgress = false;
    reportMetricEvent("lesson_completed", {});
    if (typeof onDone === "function") onDone();
  }
  const closeBtn = root.querySelector("#lw-close");
  const contBtn = root.querySelector("#lw-continue");
  const reportBtn = root.querySelector("#lw-report-bad");
  if (closeBtn) closeBtn.addEventListener("click", finish);
  if (contBtn) contBtn.addEventListener("click", finish);
  if (reportBtn) reportBtn.addEventListener("click", function () { if (typeof reportFeedback === "function") reportFeedback(); });
  const bar = root.querySelector("#lw-progress-bar");
  if (bar) {
    progressFinishHandler = function () { finish(); };
    bar.addEventListener("animationend", progressFinishHandler);
  }
}

async function triggerLesson() {
  if (lessonInProgress || !isActiveOnThisPage()) {
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
  const cancelRef = { cancelled: false };

  const video = document.querySelector("video");
  if (video) video.pause();
  removeOverlay();
  const parent = getOverlayMountParent();
  parent.insertAdjacentHTML("beforeend", buildOverlayHtmlLoading());
  wireOverlayClose(function () { scheduleNextLesson(); }, cancelRef);

  let translateResult;
  try {
    translateResult = await browser.runtime.sendMessage({
      type: "TRANSLATE",
      sourcePhrase: phrase,
      lessonDirection: currentSettings.lessonDirection || "en_to_es",
    });
  } catch (e) {
    reportMetricEvent("lesson_error", { reason: "translate_message_error" });
    showError("Translation failed: " + (e && e.message ? e.message : String(e)));
    removeOverlay();
    lessonInProgress = false;
    scheduleNextLesson();
    return;
  }

  if (cancelRef.cancelled) return;
  if (typeof translateResult === "string") {
    reportMetricEvent("lesson_error", { reason: "translate_response_error" });
    showError(translateResult);
    removeOverlay();
    lessonInProgress = false;
    scheduleNextLesson();
    return;
  }

  const data = {
    sourcePhrase: phrase,
    translation: translateResult.translation,
    wordBreakdown: translateResult.wordBreakdown,
    grammarNote: translateResult.grammarNote,
    exampleSource: translateResult.exampleSource,
    exampleTarget: translateResult.exampleTarget,
  };

  const lessonSnapshot = {
    sourcePhrase: data.sourcePhrase,
    translation: data.translation,
    lessonDirection: currentSettings.lessonDirection || "en_to_es",
    host: window.location.hostname,
    ts: Date.now(),
  };

  removeOverlay();
  if (cancelRef.cancelled) return;
  parent.insertAdjacentHTML("beforeend", buildOverlayHtmlContent(data));
  reportMetricEvent("lesson_shown", { host: window.location.hostname });

  function reportFeedback() {
    reportMetricEvent("bad_translation_report", lessonSnapshot);
    showError("Thanks - feedback captured.");
  }

  wireOverlayClose(function () { scheduleNextLesson(); }, cancelRef, reportFeedback);
}

function pollSubtitles() {
  const cleaned = cleanSubtitleText(getSubtitleTextFromDom());
  if (!cleaned || countWords(cleaned) < MIN_PHRASE_WORDS || cleaned === lastPushedSubtitle) return;
  lastPushedSubtitle = cleaned;
  subtitleBuffer.push(cleaned);
  if (subtitleBuffer.length > MAX_BUFFER_SIZE) subtitleBuffer = subtitleBuffer.slice(subtitleBuffer.length - MAX_BUFFER_SIZE);
}

function onStorageChanged(_changes, area) {
  if (area !== "sync") return;
  loadSettings().then(function () {
    if (!isActiveOnThisPage()) clearLessonTimer();
    else if (!lessonInProgress) scheduleNextLesson();
  });
}

async function init() {
  await loadSettings();
  browser.storage.onChanged.addListener(onStorageChanged);
  window.addEventListener("keydown", function (event) {
    if (event.shiftKey && (event.key === "L" || event.key === "l")) {
      event.preventDefault();
      triggerLesson();
    }
  }, true);
  window.setInterval(pollSubtitles, 1000);
  window.setTimeout(function () {
    if (isActiveOnThisPage()) scheduleNextLesson();
  }, 10000);
}

init();
