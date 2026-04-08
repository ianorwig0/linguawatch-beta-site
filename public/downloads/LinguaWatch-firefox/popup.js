/* global browser */

const DEFAULTS = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: 8,
  targetLanguage: "es",
};

let currentTabHostname = "";

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

  const activeLesson =
    globalOn &&
    onYouTube &&
    currentTabHostname &&
    disabled.indexOf(currentTabHostname) === -1;
  if (activeLesson) {
    setStatus(true, "Active on this page — lessons will appear while you watch.");
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

  let data;
  try {
    data = await browser.storage.sync.get(DEFAULTS);
  } catch (e) {
    console.error("[LinguaWatch popup] storage.get", e);
    data = DEFAULTS;
  }

  updateUiFromData(data, tab);

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

  try {
    await browser.storage.sync.set({
      globalEnabled,
      disabledHosts,
      lessonFrequencyMinutes,
      targetLanguage,
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

function boot() {
  load();
  const saveBtn = document.getElementById("lw-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", save);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
