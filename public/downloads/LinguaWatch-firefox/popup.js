/* global browser */

const DEFAULTS = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: 8,
  targetLanguage: "es",
  openaiApiKey: "",
  snoozeUntil: 0,
};

let snoozeRefreshTimerId = null;

let currentTabHostname = "";
let currentTabId = null;
let currentTabIsYouTube = false;

function normalizeApiKey(value) {
  let key = String(value || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'")) ||
    (key.startsWith("`") && key.endsWith("`"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/\s+/g, "");
}

function setStatus(active, message) {
  const dot = document.getElementById("lw-status-dot");
  const text = document.getElementById("lw-status-text");
  if (!dot || !text) return;
  dot.classList.remove("lw-on", "lw-off");
  if (active) {
    dot.classList.add("lw-on");
  } else {
    dot.classList.add("lw-off");
  }
  text.textContent = message;
}

function isYouTubeUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "www.youtube.com" || u.hostname === "youtube.com" || u.hostname === "m.youtube.com";
  } catch (e) {
    return false;
  }
}

function formatSnoozeRemaining(ms) {
  const totalMin = Math.ceil(ms / 60000);
  if (totalMin <= 1) return "less than a minute";
  if (totalMin < 60) return totalMin + " min";
  const hr = Math.floor(totalMin / 60);
  const rem = totalMin % 60;
  if (rem === 0) return hr + " hr";
  return hr + " hr " + rem + " min";
}

function renderSnoozeUi(snoozeUntilValue) {
  const status = document.getElementById("lw-snooze-status");
  const row = document.getElementById("lw-snooze-row");
  const until = Number(snoozeUntilValue) || 0;
  const remaining = until - Date.now();
  const active = remaining > 0;

  if (status) {
    status.textContent = active
      ? "Snoozed for " + formatSnoozeRemaining(remaining) + " more."
      : "Auto-lessons run on schedule.";
  }

  if (row) {
    const buttons = row.querySelectorAll(".lw-snooze-btn");
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const min = Number(btn.getAttribute("data-snooze-min")) || 0;
      btn.classList.remove("is-active");
      if (active && min > 0 && Math.abs(min - Math.round(remaining / 60000)) <= 1) {
        btn.classList.add("is-active");
      }
      if (!active && min === 0) btn.classList.add("is-active");
    }
  }

  if (snoozeRefreshTimerId !== null) {
    clearTimeout(snoozeRefreshTimerId);
    snoozeRefreshTimerId = null;
  }
  if (active) {
    snoozeRefreshTimerId = window.setTimeout(function () {
      renderSnoozeUi(until);
    }, Math.min(60000, Math.max(1000, remaining)));
  }
}

async function applySnooze(minutes) {
  const msg = document.getElementById("lw-save-msg");
  const snoozeUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
  try {
    await browser.storage.sync.set({ snoozeUntil });
    renderSnoozeUi(snoozeUntil);
    if (msg) {
      msg.textContent = snoozeUntil
        ? "Auto-lessons snoozed for " + formatSnoozeRemaining(snoozeUntil - Date.now()) + "."
        : "Snooze cleared.";
      msg.classList.remove("lw-error");
    }
  } catch (e) {
    if (msg) {
      msg.textContent = "Snooze failed: " + (e && e.message ? e.message : String(e));
      msg.classList.add("lw-error");
    }
  }
}

function wireSnoozeButtons() {
  const row = document.getElementById("lw-snooze-row");
  if (!row) return;
  row.addEventListener("click", function (event) {
    const target = event.target;
    if (!target || !target.classList || !target.classList.contains("lw-snooze-btn")) return;
    const min = parseInt(target.getAttribute("data-snooze-min"), 10);
    applySnooze(Number.isFinite(min) ? min : 0);
  });
}

function updateUiFromData(data, tab) {
  const enabled = document.getElementById("lw-enabled");
  const siteEnabled = document.getElementById("lw-site-enabled");
  const lang = document.getElementById("lw-lang");
  const freq = document.getElementById("lw-frequency");
  const freqVal = document.getElementById("lw-frequency-value");
  const apiKeyInput = document.getElementById("lw-api-key");
  const hostEl = document.getElementById("lw-hostname");

  const globalOn = data.globalEnabled !== false;
  const disabled = Array.isArray(data.disabledHosts) ? data.disabledHosts : [];
  const onYouTube = tab && isYouTubeUrl(tab.url);
  currentTabHostname = tab && tab.url ? new URL(tab.url).hostname : "";

  if (hostEl) {
    hostEl.textContent = currentTabHostname || "No active tab";
  }

  if (enabled) enabled.checked = globalOn;

  if (siteEnabled) {
    if (!onYouTube || !currentTabHostname) {
      siteEnabled.disabled = true;
      siteEnabled.checked = false;
    } else {
      siteEnabled.disabled = !globalOn;
      const siteOff = disabled.indexOf(currentTabHostname) !== -1;
      siteEnabled.checked = globalOn && !siteOff;
    }
  }

  if (lang) {
    lang.value = data.targetLanguage === "es" ? "es" : "es";
  }

  const n = Math.max(5, Math.min(15, Number(data.lessonFrequencyMinutes) || DEFAULTS.lessonFrequencyMinutes));
  if (freq) freq.value = String(n);
  if (freqVal) freqVal.textContent = String(n);
  if (apiKeyInput) apiKeyInput.value = data.openaiApiKey || "";

  renderSnoozeUi(data.snoozeUntil);

  const activeLesson =
    globalOn &&
    onYouTube &&
    currentTabHostname &&
    disabled.indexOf(currentTabHostname) === -1;
  const snoozeRemaining = (Number(data.snoozeUntil) || 0) - Date.now();
  const isSnoozed = snoozeRemaining > 0;
  if (activeLesson) {
    if (data.openaiApiKey && String(data.openaiApiKey).trim()) {
      if (isSnoozed) {
        setStatus(false, "Snoozed — auto-lessons paused for " + formatSnoozeRemaining(snoozeRemaining) + ". Shift+L still works.");
      } else {
        setStatus(true, "Active on this page — lessons will appear while you watch.");
      }
    } else {
      setStatus(false, "Add your OpenAI API key to start lessons.");
    }
  } else if (!globalOn) {
    setStatus(false, "Extension is off everywhere.");
  } else if (!onYouTube) {
    setStatus(false, "Open YouTube to use LinguaWatch on this page.");
  } else {
    setStatus(false, "Paused on this site — enable “Enabled on this site”.");
  }
}

async function load() {
  const freq = document.getElementById("lw-frequency");
  const freqVal = document.getElementById("lw-frequency-value");

  if (freq && freqVal) {
    freq.addEventListener("input", function () {
      freqVal.textContent = freq.value;
    });
  }

  let tab;
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  } catch (e) {
    console.error("[LinguaWatch popup] tabs.query", e);
  }

  currentTabId = tab && tab.id ? tab.id : null;
  currentTabIsYouTube = tab && isYouTubeUrl(tab.url);

  let data;
  try {
    data = await browser.storage.sync.get(DEFAULTS);
  } catch (e) {
    console.error("[LinguaWatch popup] storage.get", e);
    data = DEFAULTS;
  }

  updateUiFromData(data, tab);
  await refreshLibraryPanels(tab);

  const siteEnabled = document.getElementById("lw-site-enabled");
  if (siteEnabled) {
    siteEnabled.addEventListener("change", function () {
      const global = document.getElementById("lw-enabled");
      if (global && !global.checked) {
        siteEnabled.checked = false;
      }
    });
  }
}

async function save() {
  const msg = document.getElementById("lw-save-msg");
  const enabled = document.getElementById("lw-enabled");
  const siteEnabled = document.getElementById("lw-site-enabled");
  const freq = document.getElementById("lw-frequency");
  const lang = document.getElementById("lw-lang");
  const apiKeyInput = document.getElementById("lw-api-key");

  let tabs;
  try {
    tabs = await browser.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    if (msg) {
      msg.textContent = "Could not read the current tab.";
      msg.classList.add("lw-error");
    }
    return;
  }

  const tab = tabs[0];
  let hostname = "";
  if (tab && tab.url) {
    try {
      hostname = new URL(tab.url).hostname;
    } catch (e) {
      hostname = "";
    }
  }

  const globalEnabled = enabled ? enabled.checked : true;
  let disabledHosts = [];
  try {
    const existing = await browser.storage.sync.get({ disabledHosts: [] });
    disabledHosts = Array.isArray(existing.disabledHosts) ? existing.disabledHosts.slice() : [];
  } catch (e) {
    disabledHosts = [];
  }

  if (hostname && siteEnabled && !siteEnabled.disabled) {
    const idx = disabledHosts.indexOf(hostname);
    if (siteEnabled.checked) {
      if (idx !== -1) disabledHosts.splice(idx, 1);
    } else {
      if (idx === -1) disabledHosts.push(hostname);
    }
  }

  const lessonFrequencyMinutes = freq
    ? Math.max(5, Math.min(15, parseInt(freq.value, 10) || DEFAULTS.lessonFrequencyMinutes))
    : DEFAULTS.lessonFrequencyMinutes;

  const targetLanguage = lang && lang.value === "es" ? "es" : "es";
  const openaiApiKey = apiKeyInput ? normalizeApiKey(apiKeyInput.value) : "";

  try {
    await browser.storage.sync.set({
      globalEnabled,
      disabledHosts,
      lessonFrequencyMinutes,
      targetLanguage,
      openaiApiKey,
    });
    if (msg) {
      msg.textContent = "Saved.";
      msg.classList.remove("lw-error");
    }
    updateUiFromData(
      {
        globalEnabled,
        disabledHosts,
        lessonFrequencyMinutes,
        targetLanguage,
        openaiApiKey,
      },
      tab
    );
  } catch (e) {
    if (msg) {
      msg.textContent = "Save failed: " + (e && e.message ? e.message : String(e));
      msg.classList.add("lw-error");
    }
  }
}

function extractYouTubeVideoId(url) {
  if (!url) return "";
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

function sameYouTubeVideo(urlA, urlB) {
  const a = extractYouTubeVideoId(urlA);
  const b = extractYouTubeVideoId(urlB);
  return !!(a && b && a === b);
}

function truncateText(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function renderPhraseList(container, phrases, options) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(phrases) ? phrases : [];
  const unique = [];
  const seen = Object.create(null);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = String(list[i] || "").trim();
    if (!p || seen[p]) continue;
    seen[p] = true;
    unique.unshift(p);
  }

  const show = unique.slice(-8).reverse();
  if (!show.length) {
    const empty = document.createElement("p");
    empty.className = "lw-phrase-empty";
    empty.textContent = options && options.emptyText ? options.emptyText : "Nothing here yet.";
    container.appendChild(empty);
    return;
  }

  for (let j = 0; j < show.length; j++) {
    const phrase = show[j];
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lw-phrase-btn";
    btn.textContent = truncateText(phrase, 90);
    if (options && options.subtitle) {
      const small = document.createElement("small");
      small.textContent = options.subtitle;
      btn.appendChild(small);
    }
    if (options && typeof options.onPick === "function") {
      btn.addEventListener("click", function () {
        options.onPick(phrase);
      });
    }
    li.appendChild(btn);
    container.appendChild(li);
  }
}

function escHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Send a TTS replay request to the active YouTube tab. Fire-and-forget. */
function speakInTab(text, voice) {
  if (!text) return;
  browser.tabs
    .query({ active: true, currentWindow: true })
    .then(function (tabs) {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      return browser.tabs.sendMessage(tab.id, { type: "LW_SPEAK", text: text, voice: voice });
    })
    .catch(function () {
      /* content script may not be loaded on non-YT tabs — silent */
    });
}

function getPrevDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

/** Compute the user's current streak from a list of ISO calendar dates. */
function computeStreak(dailyLessonDates) {
  if (!Array.isArray(dailyLessonDates) || !dailyLessonDates.length) return 0;
  const today = new Date().toLocaleDateString("en-CA");
  const sorted = Array.from(new Set(dailyLessonDates)).sort().reverse();
  if (sorted[0] !== today && sorted[0] !== getPrevDay(today)) return 0;
  let streak = 0;
  let cursor = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] === cursor) {
      streak++;
      cursor = getPrevDay(cursor);
    } else if (sorted[i] < cursor) {
      break;
    }
  }
  return streak;
}

/** Render a 35-day heatmap grid. Returns an HTML string. */
function buildStreakCalendar(dailyLessonDates) {
  const dateSet = new Set(Array.isArray(dailyLessonDates) ? dailyLessonDates : []);
  const todayDate = new Date();
  const todayStr = todayDate.toLocaleDateString("en-CA");
  const days = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    days.push(d.toLocaleDateString("en-CA"));
  }

  const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
  let html = '<div class="lw-cal-grid">';
  for (let i = 0; i < DOW_LABELS.length; i++) {
    html += '<span class="lw-cal-dow">' + DOW_LABELS[i] + "</span>";
  }
  const firstDow = new Date(days[0] + "T12:00:00").getDay();
  for (let i = 0; i < firstDow; i++) {
    html += '<span class="lw-cal-day lw-cal-empty"></span>';
  }
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const active = dateSet.has(d) ? " lw-cal-active" : "";
    const isToday = d === todayStr ? " lw-cal-today" : "";
    html += '<span class="lw-cal-day' + active + isToday + '" title="' + d + '"></span>';
  }
  html += "</div>";
  return html;
}

function buildFilterChips(saved) {
  const container = document.getElementById("lw-filter-chips");
  if (!container) return;
  container.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "lw-chip lw-chip-active";
  allChip.textContent = "All";
  allChip.addEventListener("click", function () {
    container.querySelectorAll(".lw-chip").forEach(function (c) {
      c.classList.remove("lw-chip-active");
    });
    allChip.classList.add("lw-chip-active");
    renderSavedLessons(document.getElementById("lw-saved-lessons"), saved);
  });
  container.appendChild(allChip);

  const seen = new Map();
  for (let i = 0; i < saved.length; i++) {
    const l = saved[i];
    if (!l || !l.videoUrl) continue;
    if (!seen.has(l.videoUrl)) seen.set(l.videoUrl, l.videoTitle || l.videoUrl);
    if (seen.size >= 6) break;
  }

  seen.forEach(function (title, url) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lw-chip";
    chip.dataset.url = url;
    chip.textContent = truncateText(title, 22);
    chip.title = title;
    chip.addEventListener("click", function () {
      container.querySelectorAll(".lw-chip").forEach(function (c) {
        c.classList.remove("lw-chip-active");
      });
      chip.classList.add("lw-chip-active");
      renderSavedLessons(document.getElementById("lw-saved-lessons"), saved);
    });
    container.appendChild(chip);
  });
}

function renderSavedLessons(container, lessons) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(lessons) ? lessons : [];
  if (!list.length) {
    container.innerHTML =
      '<li class="lw-empty-state">No lessons saved yet.<br>Watch a Spanish video to start.</li>';
    return;
  }

  const activeChip = document.querySelector(".lw-chip.lw-chip-active");
  const filterUrl = activeChip ? activeChip.dataset.url : null;
  const filtered = filterUrl ? list.filter(function (r) { return r.videoUrl === filterUrl; }) : list;
  const display = filtered.slice(0, 40);

  for (let i = 0; i < display.length; i++) {
    const item = display[i];
    if (!item) continue;

    const esPhrase = item.translation || "";
    const enPhrase = item.englishPhrase || "";
    const focusEs = item.focusWord ? item.focusWord.spanish || "" : "";
    const focusEn = item.focusWord ? item.focusWord.english || "" : "";

    const li = document.createElement("li");
    li.className = "lw-saved-row";
    li.innerHTML =
      '<div class="lw-row-main">' +
      '<button type="button" class="lw-row-btn">' +
      '<span class="lw-row-es">' + escHtml(esPhrase) + "</span>" +
      '<span class="lw-row-en">' + escHtml(enPhrase) + "</span>" +
      (focusEs
        ? '<span class="lw-row-chip">' + escHtml(focusEs) + " · " + escHtml(focusEn) + "</span>"
        : "") +
      "</button>" +
      "</div>" +
      '<div class="lw-row-actions">' +
      '<button type="button" class="lw-btn-icon lw-row-tts" title="Play Spanish TTS" aria-label="Play Spanish TTS">🔊</button>' +
      '<button type="button" class="lw-btn-icon lw-row-relearn" title="Fresh lesson (uses API)" aria-label="Re-learn phrase">↻</button>' +
      "</div>";

    li.querySelector(".lw-row-btn").addEventListener("click", function () {
      quickReviewOnTab(item);
    });
    li.querySelector(".lw-row-tts").addEventListener("click", function (event) {
      event.stopPropagation();
      speakInTab(item.translation, "nova");
    });
    li.querySelector(".lw-row-relearn").addEventListener("click", function (event) {
      event.stopPropagation();
      triggerPhraseOnTab(item.englishPhrase, item.videoTime);
    });

    container.appendChild(li);
  }

  if (filtered.length > 40) {
    const more = document.createElement("li");
    more.className = "lw-more-hint";
    more.textContent = "+" + (filtered.length - 40) + " more — export CSV to see all";
    container.appendChild(more);
  }
}

async function quickReviewOnTab(record) {
  const msg = document.getElementById("lw-save-msg");
  if (!currentTabId || !currentTabIsYouTube) {
    if (msg) {
      msg.textContent = "Open a YouTube watch page first.";
      msg.classList.add("lw-error");
    }
    return;
  }
  if (!record || !record.translation) {
    triggerPhraseOnTab(record && record.englishPhrase ? record.englishPhrase : "", record && record.videoTime);
    return;
  }
  try {
    const res = await browser.tabs.sendMessage(currentTabId, {
      type: "LW_QUICK_REVIEW",
      record: record,
    });
    if (res && res.ok) {
      if (msg) {
        msg.textContent = "Review opened on this tab.";
        msg.classList.remove("lw-error");
      }
      window.close();
    } else if (msg) {
      msg.textContent =
        res && res.reason === "busy"
          ? "A lesson is already running on this tab."
          : "Could not open review on this tab.";
      msg.classList.add("lw-error");
    }
  } catch (e) {
    if (msg) {
      msg.textContent = "Reload the YouTube page, then try again.";
      msg.classList.add("lw-error");
    }
  }
}

async function triggerPhraseOnTab(phrase, videoTime) {
  const msg = document.getElementById("lw-save-msg");
  if (!currentTabId || !currentTabIsYouTube) {
    if (msg) {
      msg.textContent = "Open a YouTube watch page first.";
      msg.classList.add("lw-error");
    }
    return;
  }
  try {
    const res = await browser.tabs.sendMessage(currentTabId, {
      type: "LW_TRIGGER_PHRASE",
      phrase: phrase,
      videoTime: typeof videoTime === "number" ? videoTime : undefined,
    });
    if (res && res.ok) {
      if (msg) {
        msg.textContent = "Lesson started on this tab.";
        msg.classList.remove("lw-error");
      }
      window.close();
    } else if (msg) {
      msg.textContent =
        res && res.reason === "busy"
          ? "A lesson is already running on this tab."
          : "Could not start lesson on this tab.";
      msg.classList.add("lw-error");
    }
  } catch (e) {
    if (msg) {
      msg.textContent = "Reload the YouTube page, then try again.";
      msg.classList.add("lw-error");
    }
  }
}

async function refreshLibraryPanels(tab) {
  const sessionList = document.getElementById("lw-session-phrases");
  const sessionCount = document.getElementById("lw-session-count");
  const sessionVideo = document.getElementById("lw-session-video");
  const savedList = document.getElementById("lw-saved-lessons");
  const savedCount = document.getElementById("lw-saved-count");

  let sessionPhrases = [];
  let videoTitle = "";

  if (tab && isYouTubeUrl(tab.url) && tab.id) {
    try {
      const live = await browser.tabs.sendMessage(tab.id, { type: "LW_GET_STATE" });
      if (live && Array.isArray(live.sessionPhrases)) {
        sessionPhrases = live.sessionPhrases;
        videoTitle = live.videoTitle || "";
      }
    } catch (e) {
      /* content script may not be ready */
    }
  }

  let localData = {
    sessionPhrases: [],
    sessionVideoTitle: "",
    sessionVideoUrl: "",
    savedLessons: [],
    dailyLessonDates: [],
  };
  try {
    localData = await browser.storage.local.get({
      sessionPhrases: [],
      sessionVideoTitle: "",
      sessionVideoUrl: "",
      savedLessons: [],
      dailyLessonDates: [],
    });
  } catch (e) {
    console.error("[LinguaWatch popup] local storage", e);
  }

  const tabUrl = tab && tab.url ? tab.url : "";
  const canUseStoredSession =
    !sessionPhrases.length &&
    Array.isArray(localData.sessionPhrases) &&
    localData.sessionPhrases.length &&
    tabUrl &&
    localData.sessionVideoUrl &&
    sameYouTubeVideo(localData.sessionVideoUrl, tabUrl);

  if (canUseStoredSession) {
    sessionPhrases = localData.sessionPhrases;
  }
  if (!videoTitle && canUseStoredSession && localData.sessionVideoTitle) {
    videoTitle = localData.sessionVideoTitle;
  }

  if (sessionCount) sessionCount.textContent = String(sessionPhrases.length);
  if (sessionVideo) {
    sessionVideo.textContent = videoTitle
      ? "Recent lines from: " + truncateText(videoTitle, 48)
      : tab && isYouTubeUrl(tab.url)
        ? "Recent caption lines from this watch."
        : "Open a YouTube watch page to see recent caption lines.";
  }

  renderPhraseList(sessionList, sessionPhrases, {
    emptyText: "Keep watching with captions on — lines appear here.",
    onPick: triggerPhraseOnTab,
  });

  const saved = Array.isArray(localData.savedLessons) ? localData.savedLessons : [];
  const dates = Array.isArray(localData.dailyLessonDates) ? localData.dailyLessonDates : [];

  const wordCountEl = document.getElementById("lw-stat-words");
  const videoCountEl = document.getElementById("lw-stat-videos");
  const streakCountEl = document.getElementById("lw-stat-streak");
  const calContainer = document.getElementById("lw-streak-calendar");

  const allWords = new Set();
  for (let i = 0; i < saved.length; i++) {
    const phrase = (saved[i] && saved[i].translation) || "";
    const cleaned = phrase.toLowerCase().replace(/[^a-záéíóúüñ ]/gi, "");
    const parts = cleaned.split(" ");
    for (let j = 0; j < parts.length; j++) {
      if (parts[j].length > 2) allWords.add(parts[j]);
    }
  }
  const uniqueVideos = new Set();
  for (let i = 0; i < saved.length; i++) {
    if (saved[i] && saved[i].videoUrl) uniqueVideos.add(saved[i].videoUrl);
  }
  const streak = computeStreak(dates);

  if (wordCountEl) wordCountEl.textContent = String(allWords.size);
  if (videoCountEl) videoCountEl.textContent = String(uniqueVideos.size);
  if (streakCountEl) streakCountEl.textContent = streak > 0 ? "🔥 " + streak : "–";
  if (savedCount) savedCount.textContent = String(saved.length);

  buildFilterChips(saved);
  renderSavedLessons(savedList, saved);

  if (calContainer) calContainer.innerHTML = buildStreakCalendar(dates);
}

function lessonsToCsv(lessons) {
  const rows = [["date", "english", "spanish", "focus_word", "video_title", "video_url"]];
  for (let i = 0; i < lessons.length; i++) {
    const item = lessons[i];
    if (!item) continue;
    const date = new Date(item.ts || 0).toISOString();
    rows.push([
      date,
      item.englishPhrase || "",
      item.translation || "",
      item.focusWord && item.focusWord.spanish ? item.focusWord.spanish : "",
      item.videoTitle || "",
      item.videoUrl || "",
    ]);
  }
  return rows
    .map(function (row) {
      return row
        .map(function (cell) {
          return '"' + String(cell).replace(/"/g, '""') + '"';
        })
        .join(",");
    })
    .join("\n");
}

async function exportSavedCsv() {
  const msg = document.getElementById("lw-save-msg");
  try {
    const res = await browser.storage.local.get({ savedLessons: [] });
    const lessons = Array.isArray(res.savedLessons) ? res.savedLessons : [];
    if (!lessons.length) {
      if (msg) {
        msg.textContent = "Nothing to export yet.";
        msg.classList.add("lw-error");
      }
      return;
    }
    const blob = new Blob([lessonsToCsv(lessons)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({
      url: url,
      filename: "linguawatch-lessons.csv",
      saveAs: true,
    });
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 10000);
    if (msg) {
      msg.textContent = "Export started.";
      msg.classList.remove("lw-error");
    }
  } catch (e) {
    if (msg) {
      msg.textContent = "Export failed.";
      msg.classList.add("lw-error");
    }
  }
}

async function clearSavedLessons() {
  const msg = document.getElementById("lw-save-msg");
  try {
    await browser.storage.local.set({ savedLessons: [] });
    await refreshLibraryPanels(
      currentTabId
        ? { id: currentTabId, url: currentTabIsYouTube ? "https://www.youtube.com/" : "" }
        : null
    );
    if (msg) {
      msg.textContent = "Saved lessons cleared.";
      msg.classList.remove("lw-error");
    }
  } catch (e) {
    if (msg) {
      msg.textContent = "Clear failed.";
      msg.classList.add("lw-error");
    }
  }
}

function boot() {
  load();
  wireSnoozeButtons();
  const saveBtn = document.getElementById("lw-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", save);
  }
  const exportBtn = document.getElementById("lw-export-csv");
  if (exportBtn) exportBtn.addEventListener("click", exportSavedCsv);
  const clearBtn = document.getElementById("lw-clear-saved");
  if (clearBtn) clearBtn.addEventListener("click", clearSavedLessons);

  const streakToggle = document.getElementById("lw-stat-streak");
  const streakCal = document.getElementById("lw-streak-calendar");
  if (streakToggle && streakCal) {
    streakToggle.addEventListener("click", function () {
      const hidden = streakCal.style.display === "none" || !streakCal.style.display;
      streakCal.style.display = hidden ? "block" : "none";
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
