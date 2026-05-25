/* global browser */

const DEFAULTS = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: 8,
  targetLanguage: "es",
  openaiApiKey: "",
};

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

  const activeLesson =
    globalOn &&
    onYouTube &&
    currentTabHostname &&
    disabled.indexOf(currentTabHostname) === -1;
  if (activeLesson) {
    if (data.openaiApiKey && String(data.openaiApiKey).trim()) {
      setStatus(true, "Active on this page — lessons will appear while you watch.");
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

function renderSavedLessons(container, lessons) {
  if (!container) return;
  container.innerHTML = "";
  const list = Array.isArray(lessons) ? lessons : [];
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "lw-phrase-empty";
    empty.textContent = "Complete a lesson to save it here.";
    container.appendChild(empty);
    return;
  }

  for (let i = 0; i < Math.min(list.length, 12); i++) {
    const item = list[i];
    if (!item) continue;
    const li = document.createElement("li");
    li.className = "lw-saved-row";

    const reviewBtn = document.createElement("button");
    reviewBtn.type = "button";
    reviewBtn.className = "lw-phrase-btn lw-phrase-btn-grow";
    const focus = item.focusWord && item.focusWord.spanish ? item.focusWord.spanish + " — " : "";
    reviewBtn.textContent = truncateText(focus + item.englishPhrase, 80);
    const small = document.createElement("small");
    small.textContent = truncateText(item.translation || item.videoTitle || "", 72);
    reviewBtn.appendChild(small);
    reviewBtn.addEventListener("click", function () {
      quickReviewOnTab(item);
    });

    const relearnBtn = document.createElement("button");
    relearnBtn.type = "button";
    relearnBtn.className = "lw-btn-icon";
    relearnBtn.title = "Re-learn (new lesson)";
    relearnBtn.setAttribute("aria-label", "Re-learn phrase");
    relearnBtn.textContent = "↻";
    relearnBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      triggerPhraseOnTab(item.englishPhrase, item.videoTime);
    });

    li.appendChild(reviewBtn);
    li.appendChild(relearnBtn);
    container.appendChild(li);
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

  let localData = { sessionPhrases: [], sessionVideoTitle: "", sessionVideoUrl: "", savedLessons: [] };
  try {
    localData = await browser.storage.local.get({
      sessionPhrases: [],
      sessionVideoTitle: "",
      sessionVideoUrl: "",
      savedLessons: [],
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
  if (savedCount) savedCount.textContent = String(saved.length);
  renderSavedLessons(savedList, saved);
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
  const saveBtn = document.getElementById("lw-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", save);
  }
  const exportBtn = document.getElementById("lw-export-csv");
  if (exportBtn) exportBtn.addEventListener("click", exportSavedCsv);
  const clearBtn = document.getElementById("lw-clear-saved");
  if (clearBtn) clearBtn.addEventListener("click", clearSavedLessons);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
