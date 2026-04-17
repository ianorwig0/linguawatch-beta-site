/* global browser */

const DEFAULTS = {
  globalEnabled: true,
  disabledHosts: [],
  lessonFrequencyMinutes: 8,
  lessonDirection: "en_to_es",
  platformEnabled: {
    youtube: true,
    netflix: false,
    max: false,
  },
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

function isSupportedStreamingUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const host = u.hostname;
    return (
      host === "www.youtube.com" ||
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "www.netflix.com" ||
      host === "netflix.com" ||
      host === "www.max.com" ||
      host === "max.com" ||
      host === "play.hbomax.com"
    );
  } catch (e) {
    return false;
  }
}

function getPlatformFromHostname(host) {
  if (!host) return null;
  if (host === "www.youtube.com" || host === "youtube.com" || host === "m.youtube.com") return "youtube";
  if (host === "www.netflix.com" || host === "netflix.com") return "netflix";
  if (host === "www.max.com" || host === "max.com" || host === "play.hbomax.com") return "max";
  return null;
}

function getPlatformEnabledMap(data) {
  const fallback = DEFAULTS.platformEnabled;
  const incoming = data && data.platformEnabled && typeof data.platformEnabled === "object" ? data.platformEnabled : {};
  return {
    youtube: incoming.youtube !== false && fallback.youtube !== false,
    netflix: incoming.netflix === true,
    max: incoming.max === true,
  };
}

function formatStats(stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  const shown = Number(s.lessonsShown || 0);
  const completed = Number(s.lessonsCompleted || 0);
  const errors = Number(s.lessonsErrored || 0);
  const feedback = Number(s.badTranslationReports || 0);
  const conversion = shown > 0 ? Math.round((completed / shown) * 100) : 0;
  return "Shown: " + shown + " | Completed: " + completed + " (" + conversion + "%) | Errors: " + errors + " | Reports: " + feedback;
}

function updateUiFromData(data, tab) {
  const enabled = document.getElementById("lw-enabled");
  const siteEnabled = document.getElementById("lw-site-enabled");
  const direction = document.getElementById("lw-direction");
  const freq = document.getElementById("lw-frequency");
  const freqVal = document.getElementById("lw-frequency-value");
  const hostEl = document.getElementById("lw-hostname");
  const apiKey = document.getElementById("lw-api-key");
  const youtubeToggle = document.getElementById("lw-platform-youtube");
  const netflixToggle = document.getElementById("lw-platform-netflix");
  const maxToggle = document.getElementById("lw-platform-max");
  const statsSummary = document.getElementById("lw-stats-summary");

  const globalOn = data.globalEnabled !== false;
  const disabled = Array.isArray(data.disabledHosts) ? data.disabledHosts : [];
  const onSupportedSite = tab && isSupportedStreamingUrl(tab.url);
  const platformEnabled = getPlatformEnabledMap(data);
  currentTabHostname = tab && tab.url ? new URL(tab.url).hostname : "";
  const currentPlatform = getPlatformFromHostname(currentTabHostname);

  if (hostEl) {
    hostEl.textContent = currentTabHostname || "No active tab";
  }

  if (enabled) enabled.checked = globalOn;

  if (youtubeToggle) youtubeToggle.checked = !!platformEnabled.youtube;
  if (netflixToggle) netflixToggle.checked = !!platformEnabled.netflix;
  if (maxToggle) maxToggle.checked = !!platformEnabled.max;

  if (siteEnabled) {
    if (!onSupportedSite || !currentTabHostname) {
      siteEnabled.disabled = true;
      siteEnabled.checked = false;
    } else {
      siteEnabled.disabled = !globalOn;
      const siteOff = disabled.indexOf(currentTabHostname) !== -1;
      siteEnabled.checked = globalOn && !siteOff;
    }
  }

  if (direction) {
    direction.value = data.lessonDirection === "es_to_en" ? "es_to_en" : "en_to_es";
  }

  if (apiKey) {
    apiKey.value = typeof data.openaiApiKey === "string" ? data.openaiApiKey : "";
  }

  const n = Math.max(5, Math.min(15, Number(data.lessonFrequencyMinutes) || DEFAULTS.lessonFrequencyMinutes));
  if (freq) freq.value = String(n);
  if (freqVal) freqVal.textContent = String(n);

  const activeLesson =
    globalOn &&
    onSupportedSite &&
    currentTabHostname &&
    disabled.indexOf(currentTabHostname) === -1 &&
    !!(currentPlatform && platformEnabled[currentPlatform]);
  if (activeLesson) {
    setStatus(true, "Active on this page — lessons will appear while you watch.");
  } else if (!globalOn) {
    setStatus(false, "Extension is off everywhere.");
  } else if (!onSupportedSite) {
    setStatus(false, "Open YouTube, Netflix, or Max to use LinguaWatch on this page.");
  } else if (currentPlatform && !platformEnabled[currentPlatform]) {
    setStatus(false, "Platform is disabled in settings.");
  } else {
    setStatus(false, "Paused on this site — enable “Enabled on this site”.");
  }

  if (statsSummary) {
    statsSummary.textContent = formatStats(data.metrics);
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

  let localData = {};
  try {
    localData = await browser.storage.local.get({
      openaiApiKey: "",
      metrics: {
        lessonsShown: 0,
        lessonsCompleted: 0,
        lessonsErrored: 0,
        badTranslationReports: 0,
      },
    });
  } catch (e) {
    localData = { openaiApiKey: "", metrics: {} };
  }

  updateUiFromData({ ...data, ...localData }, tab);

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
  const direction = document.getElementById("lw-direction");
  const apiKey = document.getElementById("lw-api-key");
  const youtubeToggle = document.getElementById("lw-platform-youtube");
  const netflixToggle = document.getElementById("lw-platform-netflix");
  const maxToggle = document.getElementById("lw-platform-max");

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

  const lessonDirection = direction && direction.value === "es_to_en" ? "es_to_en" : "en_to_es";
  const openaiApiKey = apiKey ? apiKey.value.trim() : "";
  const platformEnabled = {
    youtube: youtubeToggle ? youtubeToggle.checked : true,
    netflix: netflixToggle ? netflixToggle.checked : false,
    max: maxToggle ? maxToggle.checked : false,
  };

  try {
    await browser.storage.sync.set({
      globalEnabled,
      disabledHosts,
      lessonFrequencyMinutes,
      lessonDirection,
      platformEnabled,
    });
    await browser.storage.local.set({
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
        lessonDirection,
        platformEnabled,
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

function boot() {
  load();
  const saveBtn = document.getElementById("lw-save");
  const resetBtn = document.getElementById("lw-reset-stats");
  if (saveBtn) {
    saveBtn.addEventListener("click", save);
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", async function () {
      const msg = document.getElementById("lw-save-msg");
      try {
        await browser.storage.local.set({
          metrics: {
            lessonsShown: 0,
            lessonsCompleted: 0,
            lessonsErrored: 0,
            badTranslationReports: 0,
          },
        });
        if (msg) {
          msg.textContent = "Stats reset.";
          msg.classList.remove("lw-error");
        }
        load();
      } catch (e) {
        if (msg) {
          msg.textContent = "Stats reset failed: " + (e && e.message ? e.message : String(e));
          msg.classList.add("lw-error");
        }
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
