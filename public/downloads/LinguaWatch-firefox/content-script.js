/* global browser */

const LESSON_MIN_MS = 5 * 60 * 1000;
const LESSON_MAX_MS = 10 * 60 * 1000;
const MIN_PHRASE_WORDS = 5;
const MAX_PHRASE_WORDS = 22;
const MANUAL_MIN_PHRASE_WORDS = 4;
const MANUAL_MAX_PHRASE_WORDS = 28;
const MAX_BUFFER_SIZE = 30;
const MAX_SAVED_LESSONS = 60;
const SESSION_PHRASE_SYNC_MS = 2500;
const REPLAY_SEEK_BACK_SEC = 4;
const REPLAY_PLAY_MS = 4500;
const TTS_SPEED_EN = 1.05;
const TTS_SPEED_ES = 1.0;
const TTS_GAP_MS = 180;
const TTS_VOICE_EN = "onyx";
const TTS_VOICE_ES = "nova";

const DEFAULT_LESSON_FREQUENCY_MINUTES = Math.round((LESSON_MIN_MS + LESSON_MAX_MS) / 2 / 60000);

/** Prefer the real caption layer so we never scrape `[class*='caption']` UI (Search, unmute, etc.). */
const YT_CAPTION_WINDOW = ".ytp-caption-window-container";

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
let activeAudioPlayers = [];
let sessionPhraseSyncTimer = null;
let currentLessonVideoTime = 0;
let replayStopTimerId = null;
let currentWatchUrl = location.href;
let navigationPollId = null;
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

function limitWords(text, maxWords) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function stripPlayerUiGlue(raw) {
  let t = String(raw || "");
  t = t.replace(/\bTap\s+to\s+unmute\b/gi, " ");
  t = t.replace(/\bTap\s+to\s+mute\b/gi, " ");
  t = t.replace(/\bIf\s+playback\s+doesn'?t\s+begin\s+shortly[^.?!]*/gi, " ");
  t = t.replace(/\bTry\s+restarting\s+your\s+device[^.?!]*/gi, " ");
  t = t.replace(/\bMore\s+videos\b/gi, " ");
  t = t.replace(/\bUp\s+next\b/gi, " ");
  // Speed label stuck to caption text, e.g. "2xOne of the best…"
  t = t.replace(/(?:^|\s)(?:0\.25|0\.5|0\.75|1|1\.25|1\.5|1\.75|2)x(?=[A-Za-z"'])/gi, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** YouTube captions use ">>" to mark a speaker change. Pick the most coherent
 * speaker block instead of teaching a mashed-together two-speaker fragment. */
function pickPrimarySpeakerFragment(text) {
  const s = String(text || "");
  if (s.indexOf(">>") === -1) return s.trim();
  const parts = s
    .split(/\s*>>+\s*/)
    .map(function (p) {
      return p.replace(/^\s*[-–—]\s*/, "").trim();
    })
    .filter(Boolean);
  if (!parts.length) return s.trim();
  // Prefer the longest segment (most content from one speaker), tie-broken by recency (last).
  let best = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i].length > best.length) best = parts[i];
  }
  return best;
}

function cleanSubtitleText(raw) {
  if (!raw || typeof raw !== "string") return "";
  let t = stripPlayerUiGlue(raw);
  t = pickPrimarySpeakerFragment(t);

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

function joinCaptionSegments(container) {
  if (!container) return "";
  const nodes = container.querySelectorAll(".ytp-caption-segment");
  if (!nodes.length) return "";
  const texts = [];
  for (let j = 0; j < nodes.length; j++) {
    const txt = (nodes[j].textContent || "").trim();
    if (txt) texts.push(txt);
  }
  return texts.length ? texts.join(" ") : "";
}

function getSubtitleTextFromDom() {
  const captionWin = document.querySelector(YT_CAPTION_WINDOW);
  const fromWin = joinCaptionSegments(captionWin);
  if (fromWin) return fromWin;

  const segments = document.querySelectorAll(".ytp-caption-segment");
  if (!segments.length) return "";

  const texts = [];
  for (let j = 0; j < segments.length; j++) {
    const el = segments[j];
    if (el.closest(".ytp-settings-menu") || el.closest(".ytp-popup")) continue;
    const txt = (el.textContent || "").trim();
    if (txt) texts.push(txt);
  }
  return texts.length ? texts.join(" ") : "";
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

function splitIntoSentenceLikeChunks(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const chunks = t
    .split(/(?<=[.!?])\s+|[\n\r]+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  return chunks;
}

function splitLongPhraseIntoClauses(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  return t
    .split(/[,:;]|(?:\s+-\s+)|(?:\s+—\s+)/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function looksCompletePhrase(phrase) {
  const p = String(phrase || "").trim();
  if (!p) return false;
  const wc = countWords(p);
  if (wc < MIN_PHRASE_WORDS || wc > MAX_PHRASE_WORDS) return false;
  if (/[!?.,:;\-]$/.test(p)) return true;
  if (/^(because|if|when|while|and|or|but|so)\b/i.test(p)) return false;
  return phraseHasVerbIndicator(p);
}

function getBestCandidateFromRawSubtitle(rawText) {
  const cleanedWhole = cleanSubtitleText(rawText);
  if (!cleanedWhole) return null;

  const chunks = splitIntoSentenceLikeChunks(cleanedWhole);
  const pool = [];

  for (let i = 0; i < chunks.length; i++) {
    const s = chunks[i];
    if (looksCompletePhrase(s)) pool.push(s);
    const clauses = splitLongPhraseIntoClauses(s);
    for (let j = 0; j < clauses.length; j++) {
      if (looksCompletePhrase(clauses[j])) pool.push(clauses[j]);
    }
  }

  // Prefer the most recent complete phrase seen in captions.
  if (pool.length) return pool[pool.length - 1];

  // Fallback: keep old behavior but still return recent cleaned text.
  if (countWords(cleanedWhole) >= MIN_PHRASE_WORDS && countWords(cleanedWhole) <= MAX_PHRASE_WORDS) {
    return cleanedWhole;
  }
  return null;
}

/** Build candidate sentences from the buffer:
 *  - each single fragment
 *  - consecutive 2- and 3-fragment joins (so a sentence split across captions still surfaces)
 *  Preserves recency order (older first, newest last). */
function assembleSentenceCandidates() {
  const buf = subtitleBuffer;
  const out = [];
  const seen = Object.create(null);
  const add = function (s) {
    const v = String(s || "").replace(/\s+/g, " ").trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(v);
  };
  for (let i = 0; i < buf.length; i++) {
    add(buf[i]);
    if (i + 1 < buf.length) add(buf[i] + " " + buf[i + 1]);
    if (i + 2 < buf.length) add(buf[i] + " " + buf[i + 1] + " " + buf[i + 2]);
  }
  return out;
}

function selectBestPhrase() {
  const assembled = assembleSentenceCandidates();
  const candidates = assembled.filter(function (p) {
    const wc = countWords(p);
    return wc >= MIN_PHRASE_WORDS && wc <= MAX_PHRASE_WORDS;
  });

  const filtered = candidates.filter(function (p) {
    return p !== lastPickedPhrase;
  });

  if (!filtered.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < filtered.length; i++) {
    const phrase = filtered[i];
    const wc = countWords(phrase);
    let score = Math.min(wc, 14);
    if (phraseHasVerbIndicator(phrase)) score += 3;
    if (/[.!?]$/.test(phrase)) score += 2;
    // Reward sentences that look like full thoughts (start with capital, end with terminator).
    if (/^[A-Z]/.test(phrase) && /[.!?]$/.test(phrase)) score += 1;
    // Strong recency boost — prefer what they just heard.
    const recencyBoost = (i / Math.max(1, filtered.length)) * 2;
    score += recencyBoost;
    if (score > bestScore) {
      bestScore = score;
      best = phrase;
    } else if (score === bestScore && best !== null && wc > countWords(best)) {
      best = phrase;
    }
  }

  return best;
}

function getCaptionContext(anchorPhrase) {
  const anchor = String(anchorPhrase || "").trim();
  if (!anchor) return [];

  const prior = [];
  for (let i = 0; i < subtitleBuffer.length; i++) {
    const line = String(subtitleBuffer[i] || "").trim();
    if (!line || line === anchor) continue;
    prior.push(line);
  }

  const context = prior.slice(-3);
  context.push(anchor);
  return context;
}

function resolveFocusWord(translateResult) {
  const breakdown = Array.isArray(translateResult.wordBreakdown) ? translateResult.wordBreakdown : [];
  const focus = translateResult.focusWord;
  if (focus && focus.english && focus.spanish) {
    return { english: String(focus.english).trim(), spanish: String(focus.spanish).trim() };
  }

  const question = String(translateResult.question || "").toLowerCase();
  for (let i = 0; i < breakdown.length; i++) {
    const row = breakdown[i] || {};
    const es = String(row.spanish || "").trim();
    if (es && question.indexOf(es.toLowerCase()) !== -1) {
      return { english: String(row.english || "").trim(), spanish: es };
    }
  }

  const answer = String(translateResult.correctAnswer || "").toLowerCase();
  for (let j = 0; j < breakdown.length; j++) {
    const pair = breakdown[j] || {};
    const en = String(pair.english || "").trim();
    if (en && answer.indexOf(en.toLowerCase()) !== -1) {
      return { english: en, spanish: String(pair.spanish || "").trim() };
    }
  }

  if (breakdown.length) {
    const first = breakdown[0];
    return {
      english: String(first.english || translateResult.correctAnswer || "").trim(),
      spanish: String(first.spanish || "").trim(),
    };
  }

  return {
    english: String(translateResult.correctAnswer || "").trim(),
    spanish: "",
  };
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

function getVideoTitle() {
  const el =
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
    document.querySelector("#title h1 yt-formatted-string") ||
    document.querySelector("h1 yt-formatted-string");
  if (el && el.textContent) return el.textContent.trim();
  return document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
}

function showPageToast(message, durationMs) {
  const text = String(message || "").trim();
  if (!text) return;
  let el = document.getElementById("lw-page-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "lw-page-toast";
    el.setAttribute("role", "status");
    el.className = "lw-page-toast";
    (document.body || document.documentElement).appendChild(el);
  }
  el.textContent = text;
  el.classList.add("is-visible");
  window.clearTimeout(showPageToast._hideId);
  showPageToast._hideId = window.setTimeout(function () {
    if (el) el.classList.remove("is-visible");
  }, typeof durationMs === "number" ? durationMs : 7000);
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

function extractYouTubeVideoId(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v) return v;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "shorts" && parts[1]) return parts[1];
    if (parts[0] === "live" && parts[1]) return parts[1];
    return u.pathname;
  } catch (e) {
    return "";
  }
}

function dismissActiveLesson(reschedule) {
  if (lessonCancel) {
    lessonCancel.cancelled = true;
    cancelPendingTimeouts(lessonCancel);
  }
  stopReplayPlayback();
  stopAllAudioPlayback();
  removeOverlay();
  lessonInProgress = false;
  lessonCancel = null;
  if (reschedule) scheduleNextLesson();
}

function resetSessionForNewVideo() {
  subtitleBuffer = [];
  lastPushedSubtitle = "";
  lastPickedPhrase = "";
  syncSessionPhrasesToStorage();
}

function checkWatchNavigation() {
  const href = location.href;
  if (href === currentWatchUrl) return;
  const prevId = extractYouTubeVideoId(currentWatchUrl);
  const nextId = extractYouTubeVideoId(href);
  currentWatchUrl = href;
  if (prevId && nextId && prevId !== nextId) {
    if (lessonInProgress) dismissActiveLesson(false);
    resetSessionForNewVideo();
  }
}

function getManualTriggerPhrase() {
  const raw = getSubtitleTextFromDom();
  const tryPhrase = function (text) {
    const p = String(text || "").trim();
    if (!p) return "";
    const wc = countWords(p);
    return wc >= MANUAL_MIN_PHRASE_WORDS && wc <= MANUAL_MAX_PHRASE_WORDS ? p : "";
  };

  if (raw) {
    const cleaned = cleanSubtitleText(raw);

    const chunks = splitIntoSentenceLikeChunks(cleaned);
    // Prefer a complete sentence chunk (newest first).
    for (let i = chunks.length - 1; i >= 0; i--) {
      const hit = tryPhrase(chunks[i]);
      if (hit) return hit;
    }

    // Then the whole cleaned line if it fits the manual window.
    const direct = tryPhrase(cleaned);
    if (direct) return direct;

    const clauses = splitLongPhraseIntoClauses(cleaned);
    for (let j = clauses.length - 1; j >= 0; j--) {
      const hit2 = tryPhrase(clauses[j]);
      if (hit2) return hit2;
    }
  }

  // Fall back to recent buffer-assembled sentences (newest first).
  const assembled = assembleSentenceCandidates();
  for (let k = assembled.length - 1; k >= 0; k--) {
    const hit3 = tryPhrase(assembled[k]);
    if (hit3) return hit3;
  }

  return subtitleBuffer.length > 0 ? String(subtitleBuffer[subtitleBuffer.length - 1] || "").trim() : "";
}

function scheduleSessionPhraseSync() {
  if (sessionPhraseSyncTimer !== null) return;
  sessionPhraseSyncTimer = window.setTimeout(function () {
    sessionPhraseSyncTimer = null;
    syncSessionPhrasesToStorage();
  }, SESSION_PHRASE_SYNC_MS);
}

async function syncSessionPhrasesToStorage() {
  try {
    await browser.storage.local.set({
      sessionPhrases: subtitleBuffer.slice(-20),
      sessionUpdatedAt: Date.now(),
      sessionVideoTitle: getVideoTitle(),
      sessionVideoUrl: location.href,
    });
  } catch (e) {
    console.warn("[LinguaWatch] session phrase sync", e);
  }
}

async function maybeShowShiftLTip() {
  try {
    const res = await browser.storage.local.get({ hasSeenShiftLTip: false });
    if (res.hasSeenShiftLTip) return;
    showPageToast("Tip: Press Shift+L anytime to learn the last caption line.", 9000);
    await browser.storage.local.set({ hasSeenShiftLTip: true });
  } catch (e) {
    console.warn("[LinguaWatch] shift+L tip", e);
  }
}

async function persistLessonRecord(data) {
  if (!data || !data.englishPhrase) return;
  const record = {
    id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7),
    ts: Date.now(),
    englishPhrase: data.englishPhrase,
    translation: data.translation || "",
    wordBreakdown: Array.isArray(data.wordBreakdown) ? data.wordBreakdown : [],
    focusWord: data.focusWord || null,
    grammarNote: data.grammarNote || "",
    exampleEs: data.exampleEs || "",
    exampleEn: data.exampleEn || "",
    correctAnswer: data.correctAnswer || "",
    videoTitle: getVideoTitle(),
    videoUrl: location.href,
    videoTime: typeof currentLessonVideoTime === "number" ? currentLessonVideoTime : 0,
  };

  try {
    const res = await browser.storage.local.get({ savedLessons: [] });
    const list = Array.isArray(res.savedLessons) ? res.savedLessons.slice() : [];
    const dup = list.find(function (item) {
      return (
        item &&
        item.englishPhrase === record.englishPhrase &&
        item.videoUrl === record.videoUrl &&
        record.ts - (item.ts || 0) < 3600000
      );
    });
    if (dup) {
      const idx = list.indexOf(dup);
      list[idx] = Object.assign({}, dup, record, { id: dup.id, ts: Date.now() });
      await browser.storage.local.set({ savedLessons: list.slice(0, MAX_SAVED_LESSONS) });
    } else {
      list.unshift(record);
      await browser.storage.local.set({ savedLessons: list.slice(0, MAX_SAVED_LESSONS) });
    }
  } catch (e) {
    console.warn("[LinguaWatch] persist lesson", e);
  }
}

function stopReplayPlayback() {
  if (replayStopTimerId !== null) {
    window.clearTimeout(replayStopTimerId);
    replayStopTimerId = null;
  }
}

function replayLessonLine() {
  const video = document.querySelector("video");
  if (!video) return;
  stopAllAudioPlayback();
  stopReplayPlayback();
  const anchor = Math.max(0, (currentLessonVideoTime || video.currentTime) - REPLAY_SEEK_BACK_SEC);
  try {
    video.currentTime = anchor;
    video.play();
  } catch (e) {
    console.warn("[LinguaWatch] replay", e);
    return;
  }
  replayStopTimerId = window.setTimeout(function () {
    replayStopTimerId = null;
    try {
      video.pause();
      video.currentTime = Math.max(0, currentLessonVideoTime - 0.5);
    } catch (err) {
      console.warn("[LinguaWatch] replay pause", err);
    }
  }, REPLAY_PLAY_MS);
}

function wireReplayButton() {
  const btn = document.getElementById("lw-replay-line");
  if (!btn) return;
  btn.addEventListener("click", function () {
    stopReplayPlayback();
    replayLessonLine();
  });
}

function playAudioBase64(b64) {
  return new Promise(function (resolve, reject) {
    if (!b64 || typeof b64 !== "string") {
      reject(new Error("Invalid audio"));
      return;
    }
    const audio = new Audio("data:audio/mpeg;base64," + b64);
    activeAudioPlayers.push(audio);
    const cleanup = function () {
      const idx = activeAudioPlayers.indexOf(audio);
      if (idx !== -1) activeAudioPlayers.splice(idx, 1);
    };
    audio.onended = function () {
      cleanup();
      resolve();
    };
    audio.onerror = function () {
      cleanup();
      reject(new Error("Audio playback error"));
    };
    const p = audio.play();
    if (p && typeof p.then === "function") {
      p.catch(function (err) {
        cleanup();
        reject(err);
      });
    }
  });
}

function stopAllAudioPlayback() {
  for (let i = 0; i < activeAudioPlayers.length; i++) {
    const audio = activeAudioPlayers[i];
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    } catch (e) {
      console.warn("[LinguaWatch] stopAllAudioPlayback", e);
    }
  }
  activeAudioPlayers = [];
}

function waitMs(ms, cancelRef) {
  return new Promise(function (resolve) {
    if (cancelRef && cancelRef.cancelled) {
      resolve(false);
      return;
    }
    const id = window.setTimeout(function () {
      if (cancelRef && Array.isArray(cancelRef.timeoutIds)) {
        const idx = cancelRef.timeoutIds.indexOf(id);
        if (idx !== -1) cancelRef.timeoutIds.splice(idx, 1);
      }
      resolve(!(cancelRef && cancelRef.cancelled));
    }, Math.max(0, ms));
    if (cancelRef && Array.isArray(cancelRef.timeoutIds)) {
      cancelRef.timeoutIds.push(id);
    }
  });
}

function cancelPendingTimeouts(cancelRef) {
  if (!cancelRef || !Array.isArray(cancelRef.timeoutIds)) return;
  while (cancelRef.timeoutIds.length) {
    const id = cancelRef.timeoutIds.pop();
    clearTimeout(id);
  }
}

function waitPaint() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
}

function revealStep(stepId) {
  const el = document.getElementById(stepId);
  if (el) el.classList.remove("lw-hidden");
}

function createChallengeOptions(correctAnswer, distractors) {
  const seen = Object.create(null);
  const options = [];
  const add = function (val) {
    const v = String(val || "").trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    options.push(v);
  };

  add(correctAnswer);
  const list = Array.isArray(distractors) ? distractors : [];
  for (let i = 0; i < list.length; i++) add(list[i]);

  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = options[i];
    options[i] = options[j];
    options[j] = tmp;
  }
  return options.slice(0, 3);
}

function populateBreakdownChips(wordBreakdown, focusWord) {
  const container = document.getElementById("lw-chips");
  if (!container) return [];
  container.innerHTML = "";
  const pairs = [];
  if (!Array.isArray(wordBreakdown)) return pairs;

  const focusEn = focusWord
    ? String(focusWord.english || "")
        .trim()
        .toLowerCase()
    : "";
  const focusEs = focusWord
    ? String(focusWord.spanish || "")
        .trim()
        .toLowerCase()
    : "";

  for (let i = 0; i < wordBreakdown.length && i < 6; i++) {
    const row = wordBreakdown[i] || {};
    const english = String(row.english || "").trim();
    const spanish = String(row.spanish || "").trim();
    if (!english || !spanish) continue;
    const chip = document.createElement("span");
    const isFocus =
      focusEn &&
      focusEs &&
      english.toLowerCase() === focusEn &&
      spanish.toLowerCase() === focusEs;
    chip.className = "lw-chip lw-hidden" + (isFocus ? " lw-chip-focus" : "");
    chip.textContent = english + " -> " + spanish;
    container.appendChild(chip);
    pairs.push({ english, spanish, el: chip, isFocus: isFocus });
  }
  return pairs;
}

async function speakText(text, speed, cancelRef, voice) {
  const value = String(text || "").trim();
  if (!value || (cancelRef && cancelRef.cancelled)) return;
  const payload = {
    type: "TTS",
    text: value,
    speed: typeof speed === "number" ? speed : 1,
  };
  if (typeof voice === "string" && voice) payload.voice = voice;
  const res = await browser.runtime.sendMessage(payload);
  if (cancelRef && cancelRef.cancelled) return;
  if (typeof res === "string" && res.indexOf("TTS failed") === 0) {
    showError(res);
    return;
  }
  if (typeof res !== "string" || !res.length) {
    showError("TTS failed: empty response");
    return;
  }
  await playAudioBase64(res);
}

/** Fire-and-forget TTS fetch. Resolves to base64 string on success, or null on
 *  failure / cancel. Used to prefetch audio in parallel with translation so the
 *  teacher starts speaking the instant the lesson card paints. */
async function fetchTtsB64(text, speed, cancelRef, voice) {
  const value = String(text || "").trim();
  if (!value || (cancelRef && cancelRef.cancelled)) return null;
  try {
    const payload = {
      type: "TTS",
      text: value,
      speed: typeof speed === "number" ? speed : 1,
    };
    if (typeof voice === "string" && voice) payload.voice = voice;
    const res = await browser.runtime.sendMessage(payload);
    if (cancelRef && cancelRef.cancelled) return null;
    if (typeof res !== "string" || !res.length) return null;
    if (res.indexOf("TTS failed") === 0) {
      console.warn("[LinguaWatch] TTS prefetch error", res);
      return null;
    }
    return res;
  } catch (e) {
    console.warn("[LinguaWatch] TTS prefetch threw", e);
    return null;
  }
}

async function playPrefetchedOrSpeak(audioPromise, fallbackText, speed, cancelRef, voice) {
  if (cancelRef && cancelRef.cancelled) return;
  let b64 = null;
  if (audioPromise && typeof audioPromise.then === "function") {
    b64 = await audioPromise;
  }
  if (cancelRef && cancelRef.cancelled) return;
  if (b64) {
    try {
      await playAudioBase64(b64);
      return;
    } catch (e) {
      console.warn("[LinguaWatch] prefetched audio playback failed, retrying via speakText", e);
    }
  }
  await speakText(fallbackText, speed, cancelRef, voice);
}

function revealAllLessonSteps() {
  const root = document.getElementById("lw-overlay");
  if (!root) return;
  const steps = root.querySelectorAll(".lw-step");
  for (let i = 0; i < steps.length; i++) steps[i].classList.remove("lw-hidden");
  const chips = root.querySelectorAll("#lw-chips .lw-chip");
  for (let i = 0; i < chips.length; i++) chips[i].classList.remove("lw-hidden");
}

function lwOverlayHeaderHtml() {
  return (
    '<header id="lw-header">' +
    '<h1 id="lw-logo">LinguaWatch</h1>' +
    '<button type="button" id="lw-close" aria-label="Close lesson" title="Close">×</button>' +
    "</header>"
  );
}

function buildOverlayShell(cardInnerHtml) {
  return (
    '<div id="lw-overlay" role="dialog" aria-modal="true" aria-labelledby="lw-logo">' +
    cardInnerHtml +
    "</div>"
  );
}

function buildLoadingCardInner() {
  return (
    '<div id="lw-card">' +
    lwOverlayHeaderHtml() +
    '<div id="lw-loading"><div id="lw-spinner" aria-hidden="true"></div><div>Preparing your lesson…</div></div>' +
    "</div>"
  );
}

function buildContentCardInner(data) {
  const en = escapeHtml(data.englishPhrase);
  const tr = escapeHtml(data.translation);
  const gram = escapeHtml(data.grammarNote || "");
  const exEs = escapeHtml(data.exampleEs || "");
  const exEn = escapeHtml(data.exampleEn || "");
  const question = escapeHtml(data.question || "");
  const summaryWord = data.focusWord ? escapeHtml(data.focusWord.spanish || "") : "";
  const summaryMeaning = escapeHtml(data.correctAnswer || (data.focusWord && data.focusWord.english) || "");

  return (
    '<div id="lw-card">' +
    lwOverlayHeaderHtml() +
    '<div id="lw-progress-wrap"><div id="lw-progress-bar"></div></div>' +
    '<div id="lw-main">' +
    '<div id="lw-grid" class="lw-grid-single">' +
    '<section class="lw-step lw-hidden" id="lw-step-anchor">' +
    '<p class="lw-step-label lw-step-soft">You just heard:</p>' +
    '<p class="lw-text-en" id="lw-en">' +
    en +
    "</p>" +
    '<button type="button" id="lw-replay-line" class="lw-btn-secondary">Replay line</button>' +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-reveal">' +
    '<p class="lw-step-label">In Spanish:</p>' +
    '<p class="lw-text-es" id="lw-tr">' +
    tr +
    "</p>" +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-breakdown">' +
    '<p class="lw-step-label">Word breakdown</p>' +
    '<div id="lw-chips"></div>' +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-grammar">' +
    '<p class="lw-step-label">Why it works like that:</p>' +
    '<p class="lw-grammar" id="lw-gram">' +
    gram +
    "</p>" +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-example">' +
    '<p class="lw-step-label">Try this one:</p>' +
    '<p class="lw-example-block"><span class="lw-example-es" id="lw-ex-es">' +
    exEs +
    '</span><br/><span id="lw-ex-en">' +
    exEn +
    "</span></p>" +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-challenge">' +
    '<p class="lw-step-label">Micro challenge</p>' +
    '<p class="lw-challenge-question" id="lw-question">' +
    question +
    "</p>" +
    '<div class="lw-options" id="lw-options"></div>' +
    '<p class="lw-challenge-feedback" id="lw-challenge-feedback"></p>' +
    "</section>" +
    '<section class="lw-step lw-hidden" id="lw-step-close">' +
    '<p class="lw-summary-line">You learned: <span class="lw-summary-word" id="lw-summary-es">' +
    summaryWord +
    '</span> = <span id="lw-summary-en">' +
    summaryMeaning +
    "</span></p>" +
    "</section>" +
    "</div>" +
    '<footer id="lw-footer"><button type="button" id="lw-continue">Continue Watching</button></footer>' +
    "</div>" +
    "</div>"
  );
}

function wireOverlayClose(onDone, cancelRef) {
  const root = document.getElementById("lw-overlay");
  if (!root) return;

  function finish() {
    if (cancelRef) {
      cancelRef.cancelled = true;
      cancelPendingTimeouts(cancelRef);
    }
    stopReplayPlayback();
    stopAllAudioPlayback();
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
}

function bindMicroChallenge(data, cancelRef) {
  const optionsWrap = document.getElementById("lw-options");
  const feedbackEl = document.getElementById("lw-challenge-feedback");
  if (!optionsWrap) return Promise.resolve();

  const options = createChallengeOptions(data.correctAnswer, data.distractors);
  let done = false;

  return new Promise(function (resolve) {
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lw-option";
      btn.textContent = option;
      btn.addEventListener("click", async function () {
        if (done || (cancelRef && cancelRef.cancelled)) return;
        done = true;

        const isCorrect = option === data.correctAnswer;
        const all = optionsWrap.querySelectorAll(".lw-option");
        for (let j = 0; j < all.length; j++) all[j].disabled = true;
        btn.classList.add(isCorrect ? "is-correct" : "is-wrong");

        if (feedbackEl) {
          feedbackEl.textContent = isCorrect ? "Nice work!" : "Almost! It means " + data.correctAnswer + ".";
          feedbackEl.classList.add("is-visible");
        }
        await speakText(
          isCorrect ? "Nice work!" : "Almost! It means " + data.correctAnswer + ".",
          TTS_SPEED_EN,
          cancelRef,
          TTS_VOICE_EN
        );
        resolve();
      });
      optionsWrap.appendChild(btn);
    }

    // Continue if learner does not answer quickly.
    waitMs(10000, cancelRef).then(function (ok) {
      if (!ok || done) return;
      done = true;
      if (feedbackEl) {
        feedbackEl.textContent = "Answer: " + data.correctAnswer;
        feedbackEl.classList.add("is-visible");
      }
      resolve();
    });
  });
}

async function runLessonFlow(data, cancelRef, prefetched) {
  const summaryPair = data.focusWord || { english: data.correctAnswer || "", spanish: "" };
  populateBreakdownChips(data.wordBreakdown, summaryPair);

  // Fill the close-step summary text up front so it's correct whenever we reveal it.
  const summaryWord = document.getElementById("lw-summary-es");
  if (summaryWord && summaryPair.spanish) summaryWord.textContent = summaryPair.spanish;
  const summaryLine = document.getElementById("lw-summary-en");
  if (summaryLine) summaryLine.textContent = data.correctAnswer || summaryPair.english || "";

  // Show everything at once — the teacher narrates, but the learner can read ahead.
  revealAllLessonSteps();
  const continueBtn = document.getElementById("lw-continue");
  if (continueBtn) continueBtn.classList.add("lw-pulse");
  await waitPaint();

  // Teacher: English anchor line (prefetched in parallel with TRANSLATE).
  await playPrefetchedOrSpeak(
    prefetched ? prefetched.en : null,
    data.englishPhrase,
    TTS_SPEED_EN,
    cancelRef,
    TTS_VOICE_EN
  );
  if (cancelRef && cancelRef.cancelled) return;
  if (!(await waitMs(TTS_GAP_MS, cancelRef))) return;

  // Teacher: Spanish translation in a Spanish-friendlier voice
  // (prefetch started the moment TRANSLATE resolved).
  await playPrefetchedOrSpeak(
    prefetched ? prefetched.es : null,
    data.translation,
    TTS_SPEED_ES,
    cancelRef,
    TTS_VOICE_ES
  );
  if (cancelRef && cancelRef.cancelled) return;

  // Micro challenge — question is already on screen; user reads it.
  await bindMicroChallenge(data, cancelRef);
}

function revealAllReviewSteps() {
  const ids = [
    "lw-step-anchor",
    "lw-step-reveal",
    "lw-step-breakdown",
    "lw-step-grammar",
    "lw-step-example",
    "lw-step-close",
  ];
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById(ids[i]);
    if (el) el.classList.remove("lw-hidden");
  }
  const challenge = document.getElementById("lw-step-challenge");
  if (challenge) challenge.classList.add("lw-hidden");
}

async function showQuickReview(record) {
  if (lessonInProgress || !record || !record.englishPhrase) return;
  if (!isActiveOnThisPage()) return;

  lessonInProgress = true;
  const cancelRef = { cancelled: false, timeoutIds: [] };
  lessonCancel = cancelRef;

  const focusWord =
    record.focusWord && record.focusWord.spanish
      ? record.focusWord
      : { english: record.correctAnswer || "", spanish: "" };

  const data = {
    englishPhrase: record.englishPhrase,
    translation: record.translation || "",
    wordBreakdown: Array.isArray(record.wordBreakdown) ? record.wordBreakdown : [],
    focusWord: focusWord,
    grammarNote: record.grammarNote || "",
    exampleEs: record.exampleEs || "",
    exampleEn: record.exampleEn || "",
    correctAnswer: record.correctAnswer || focusWord.english || "",
  };

  currentLessonVideoTime =
    typeof record.videoTime === "number" && record.videoTime >= 0 ? record.videoTime : 0;

  const video = document.querySelector("video");
  if (video) {
    try {
      video.pause();
    } catch (e) {
      console.warn("[LinguaWatch] quick review pause", e);
    }
  }

  removeOverlay();
  const parent = getOverlayMountParent();
  parent.insertAdjacentHTML(
    "beforeend",
    buildOverlayShell(buildContentCardInner(data)).replace(
      'id="lw-card">',
      'id="lw-card" class="lw-review-card">'
    )
  );

  const pairs = populateBreakdownChips(data.wordBreakdown, data.focusWord);
  for (let i = 0; i < pairs.length; i++) {
    pairs[i].el.classList.remove("lw-hidden");
  }
  revealAllReviewSteps();

  wireOverlayClose(function () {
    /* quick review — don't reschedule timer */
  }, cancelRef);
  wireReplayButton();

  const continueBtn = document.getElementById("lw-continue");
  if (continueBtn) continueBtn.classList.add("lw-pulse");
}

async function triggerLesson(forcedPhrase, options) {
  if (lessonInProgress) return;
  if (!isActiveOnThisPage()) {
    scheduleNextLesson();
    return;
  }

  const opts = options && typeof options === "object" ? options : {};
  const isManual = !!forcedPhrase || !!opts.manual;
  let phrase = forcedPhrase ? String(forcedPhrase).trim() : "";
  if (!phrase) phrase = selectBestPhrase();
  if (!phrase) {
    scheduleNextLesson();
    return;
  }

  const wc = countWords(phrase);
  const minW = isManual ? MANUAL_MIN_PHRASE_WORDS : MIN_PHRASE_WORDS;
  const maxW = isManual ? MANUAL_MAX_PHRASE_WORDS : MAX_PHRASE_WORDS;
  if (wc < minW || wc > maxW) {
    showPageToast(
      isManual
        ? "That caption line is too short or long for a lesson (need " + minW + "–" + maxW + " words)."
        : "That phrase is too short or long for a lesson. Keep watching for the next one.",
      5000
    );
    if (!isManual) scheduleNextLesson();
    return;
  }

  lastPickedPhrase = phrase;
  lessonInProgress = true;
  clearLessonTimer();

  const cancelRef = { cancelled: false, timeoutIds: [] };
  lessonCancel = cancelRef;

  // Kick the English-line TTS fetch off immediately — in parallel with TRANSLATE —
  // so the teacher can start speaking the moment the lesson card paints.
  const enAudioPromise = fetchTtsB64(phrase, TTS_SPEED_EN, cancelRef, TTS_VOICE_EN);

  const video = document.querySelector("video");
  if (video) {
    if (typeof opts.videoTime === "number" && opts.videoTime >= 0) {
      currentLessonVideoTime = opts.videoTime;
      try {
        video.currentTime = opts.videoTime;
      } catch (e) {
        console.warn("[LinguaWatch] seek for re-learn", e);
      }
    } else {
      currentLessonVideoTime = video.currentTime || 0;
    }
    try {
      video.pause();
    } catch (e) {
      console.warn("[LinguaWatch] video.pause", e);
    }
  } else {
    currentLessonVideoTime = typeof opts.videoTime === "number" ? opts.videoTime : 0;
  }

  removeOverlay();
  const parent = getOverlayMountParent();
  parent.insertAdjacentHTML("beforeend", buildOverlayShell(buildLoadingCardInner()));

  wireOverlayClose(function () {
    scheduleNextLesson();
  }, cancelRef);

  let translateResult;
  try {
    translateResult = await browser.runtime.sendMessage({
      type: "TRANSLATE",
      englishPhrase: phrase,
      targetLanguage: currentSettings.targetLanguage || "es",
      captionContext: getCaptionContext(phrase),
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

  // Start the Spanish-line TTS fetch the instant we have the translation, in
  // parallel with overlay swap + reveal. By the time the EN line finishes
  // playing, the ES audio is normally already buffered.
  const esAudioPromise = fetchTtsB64(
    translateResult.translation,
    TTS_SPEED_ES,
    cancelRef,
    TTS_VOICE_ES
  );

  const focusWord = resolveFocusWord(translateResult);

  const data = {
    englishPhrase: phrase,
    translation: translateResult.translation,
    wordBreakdown: translateResult.wordBreakdown,
    focusWord: focusWord,
    grammarNote: limitWords(translateResult.grammarNote, 20),
    exampleEs: translateResult.exampleEs,
    exampleEn: translateResult.exampleEn,
    question: translateResult.question,
    correctAnswer: translateResult.correctAnswer,
    distractors: translateResult.distractors,
  };

  if (cancelRef.cancelled) {
    lessonInProgress = false;
    lessonCancel = null;
    scheduleNextLesson();
    return;
  }

  const overlayEl = document.getElementById("lw-overlay");
  if (!overlayEl) {
    lessonInProgress = false;
    lessonCancel = null;
    scheduleNextLesson();
    return;
  }
  overlayEl.innerHTML = buildContentCardInner(data);

  wireOverlayClose(function () {
    scheduleNextLesson();
  }, cancelRef);
  wireReplayButton();
  maybeShowShiftLTip();

  try {
    await runLessonFlow(data, cancelRef, { en: enAudioPromise, es: esAudioPromise });
  } catch (e) {
    console.error("[LinguaWatch] lesson flow", e);
    if (!cancelRef.cancelled) {
      const continueBtn = document.getElementById("lw-continue");
      if (continueBtn) continueBtn.classList.add("lw-pulse");
    }
  }

  if (!cancelRef.cancelled) {
    await persistLessonRecord(data);
  }
  lessonCancel = null;
}

function pushBufferFragment(fragment) {
  const chunk = String(fragment || "").trim();
  if (!chunk) return false;
  const last = subtitleBuffer.length ? subtitleBuffer[subtitleBuffer.length - 1] : "";
  if (chunk === last) return false;
  const lastLower = last.toLowerCase();
  const chunkLower = chunk.toLowerCase();
  if (last && chunkLower.indexOf(lastLower) === 0) {
    // The growing caption now extends what we already had — replace in place.
    subtitleBuffer[subtitleBuffer.length - 1] = chunk;
    return true;
  }
  if (last && lastLower.indexOf(chunkLower) === 0) {
    // We already have a longer version; ignore the stale prefix.
    return false;
  }
  subtitleBuffer.push(chunk);
  return true;
}

function pollSubtitles() {
  const raw = getSubtitleTextFromDom();
  if (!raw) return;
  const cleaned = cleanSubtitleText(raw);
  if (!cleaned || cleaned === lastPushedSubtitle) return;
  lastPushedSubtitle = cleaned;

  let changed = false;
  const chunks = splitIntoSentenceLikeChunks(cleaned);
  if (chunks.length) {
    for (let i = 0; i < chunks.length; i++) {
      if (pushBufferFragment(chunks[i])) changed = true;
    }
  } else if (pushBufferFragment(cleaned)) {
    changed = true;
  }

  if (subtitleBuffer.length > MAX_BUFFER_SIZE) {
    subtitleBuffer = subtitleBuffer.slice(subtitleBuffer.length - MAX_BUFFER_SIZE);
  }
  if (changed) scheduleSessionPhraseSync();
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
    const latest = getManualTriggerPhrase();
    console.log("[LinguaWatch] Shift+L triggered", latest ? "caption line" : "auto-pick");
    triggerLesson(latest || undefined, { manual: !!latest });
  }
}

browser.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "LW_GET_STATE") {
    sendResponse({
      sessionPhrases: subtitleBuffer.slice(-20),
      lessonInProgress: lessonInProgress,
      videoTitle: getVideoTitle(),
      videoUrl: location.href,
    });
    return false;
  }

  if (message.type === "LW_QUICK_REVIEW") {
    const record = message.record;
    if (lessonInProgress) {
      sendResponse({ ok: false, reason: "busy" });
    } else if (!record || !record.englishPhrase) {
      sendResponse({ ok: false, reason: "empty" });
    } else if (!isActiveOnThisPage()) {
      sendResponse({ ok: false, reason: "inactive" });
    } else {
      showQuickReview(record);
      sendResponse({ ok: true });
    }
    return false;
  }

  if (message.type === "LW_TRIGGER_PHRASE") {
    const phrase = String(message.phrase || "").trim();
    if (lessonInProgress) {
      sendResponse({ ok: false, reason: "busy" });
    } else if (!phrase) {
      sendResponse({ ok: false, reason: "empty" });
    } else if (!isActiveOnThisPage()) {
      sendResponse({ ok: false, reason: "inactive" });
    } else {
      triggerLesson(phrase, {
        manual: true,
        videoTime: typeof message.videoTime === "number" ? message.videoTime : undefined,
      });
      sendResponse({ ok: true });
    }
    return false;
  }

  return false;
});

async function init() {
  await loadSettings();

  browser.storage.onChanged.addListener(onStorageChanged);

  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("yt-navigate-finish", checkWatchNavigation);

  subtitlePollId = window.setInterval(pollSubtitles, 1000);
  navigationPollId = window.setInterval(checkWatchNavigation, 1500);

  startDelayTimerId = window.setTimeout(function () {
    startDelayTimerId = null;
    if (isActiveOnThisPage()) scheduleNextLesson();
  }, 10000);
}

init();
