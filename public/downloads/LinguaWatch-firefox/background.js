/* global browser */

const DEFAULT_LESSON_DIRECTION = "en_to_es";
const DEFAULT_METRICS = {
  lessonsShown: 0,
  lessonsCompleted: 0,
  lessonsErrored: 0,
  badTranslationReports: 0,
};

function getDirectionInfo(lessonDirection) {
  if (lessonDirection === "es_to_en") {
    return {
      sourceLanguage: "Spanish (Latin American)",
      targetLanguage: "English",
      sourceKey: "sourceText",
      targetKey: "targetText",
      exampleSourceKey: "exampleSource",
      exampleTargetKey: "exampleTarget",
    };
  }
  return {
    sourceLanguage: "English",
    targetLanguage: "Spanish (Latin American)",
    sourceKey: "sourceText",
    targetKey: "targetText",
    exampleSourceKey: "exampleSource",
    exampleTargetKey: "exampleTarget",
  };
}

async function getOpenAiApiKey() {
  try {
    const res = await browser.storage.local.get({ openaiApiKey: "" });
    const key = typeof res.openaiApiKey === "string" ? res.openaiApiKey.trim() : "";
    return key;
  } catch (e) {
    return "";
  }
}

async function incrementMetric(metricKey) {
  try {
    const res = await browser.storage.local.get({ metrics: DEFAULT_METRICS });
    const metrics = Object.assign({}, DEFAULT_METRICS, res.metrics || {});
    metrics[metricKey] = Number(metrics[metricKey] || 0) + 1;
    await browser.storage.local.set({ metrics: metrics });
  } catch (e) {
    console.warn("[LinguaWatch BG METRICS] increment failed", e);
  }
}

async function addBadTranslationReport(payload) {
  try {
    const res = await browser.storage.local.get({
      badTranslationReports: [],
    });
    const reports = Array.isArray(res.badTranslationReports) ? res.badTranslationReports.slice() : [];
    reports.push({
      sourcePhrase: payload && payload.sourcePhrase ? String(payload.sourcePhrase) : "",
      translation: payload && payload.translation ? String(payload.translation) : "",
      lessonDirection: payload && payload.lessonDirection ? String(payload.lessonDirection) : DEFAULT_LESSON_DIRECTION,
      host: payload && payload.host ? String(payload.host) : "",
      ts: payload && payload.ts ? Number(payload.ts) : Date.now(),
    });
    const trimmed = reports.slice(Math.max(0, reports.length - 100));
    await browser.storage.local.set({
      badTranslationReports: trimmed,
    });
  } catch (e) {
    console.warn("[LinguaWatch BG METRICS] report save failed", e);
  }
}

function logTranslate(step, detail) {
  console.log("[LinguaWatch BG TRANSLATE]", step, detail !== undefined ? detail : "");
}

function logTts(step, detail) {
  console.log("[LinguaWatch BG TTS]", step, detail !== undefined ? detail : "");
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function stripJsonFences(text) {
  let t = String(text).trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

function buildLocaleBlock(lessonDirection) {
  if (lessonDirection === "es_to_en") {
    return [
      "LOCALE: The source phrase is Latin American Spanish and the translation must be natural modern English.",
      "Preserve intent and tone, and avoid robotic literal wording.",
      "For wordBreakdown, sourceText must be Spanish and targetText must be English.",
    ].join(" ");
  }
  return [
    "LOCALE: The source phrase is English and all Spanish output must be natural Latin American Spanish.",
    "Use neutral LATAM conversational Spanish (not Spain): avoid vosotros/vosotras; use ustedes for plural 'you' where needed.",
    "Prefer vocabulary common in Latin America when wording differs.",
    "For wordBreakdown, sourceText must be English and targetText must be Spanish.",
    "Match register (casual/formal) from the source phrase.",
  ].join(" ");
}

function buildTranslateSystemPrompt(lessonDirection) {
  const info = getDirectionInfo(lessonDirection);
  const locale = buildLocaleBlock(lessonDirection);
  return [
    "You are a fun, conversational language tutor.",
    locale,
    "Given a source phrase from a streaming video subtitle, respond ONLY with a valid JSON object containing exactly these fields:",
    "translation (string in " + info.targetLanguage + ", faithful to meaning in context and natural sounding),",
    "wordBreakdown (array of objects each with sourceText and targetText string fields, one per key word, maximum 6 words),",
    "grammarNote (one simple grammar rule this phrase demonstrates, plain English, under 30 words),",
    "exampleSource (one new example sentence in " + info.sourceLanguage + " using the same grammar rule),",
    "exampleTarget (translation of exampleSource in " + info.targetLanguage + ").",
    "Return ONLY the JSON object, no markdown, no backticks, no explanation.",
  ].join(" ");
}

function validateLessonJson(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (typeof parsed.translation !== "string" || !parsed.translation.trim()) return false;
  if (!Array.isArray(parsed.wordBreakdown)) return false;
  if (parsed.wordBreakdown.length > 6) return false;
  for (let i = 0; i < parsed.wordBreakdown.length; i++) {
    const row = parsed.wordBreakdown[i];
    if (!row || typeof row.sourceText !== "string" || typeof row.targetText !== "string") return false;
  }
  if (
    typeof parsed.grammarNote !== "string" ||
    typeof parsed.exampleSource !== "string" ||
    typeof parsed.exampleTarget !== "string"
  ) {
    return false;
  }
  return true;
}

async function fetchLessonJsonOnce(sourcePhrase, lessonDirection, strict, apiKey) {
  const baseSystem = buildTranslateSystemPrompt(lessonDirection);
  const system =
    baseSystem +
    (strict
      ? " Output must be a single raw JSON object only. No markdown fences, no commentary before or after the JSON."
      : "");

  const user = strict
    ? "Output one JSON object with keys translation, wordBreakdown, grammarNote, exampleSource, exampleTarget only. Phrase: " +
      sourcePhrase
    : "Translate and teach this phrase. Preserve intent and tone. Phrase: " + sourcePhrase;

  const body = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: strict ? 0.15 : 0.45,
  });

  logTranslate(strict ? "request sending (strict retry)" : "request sending");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body,
  });

  logTranslate("response status", res.status);
  if (!res.ok) {
    const errText = await res.text();
    logTranslate("response not ok", errText);
    return { error: "Translation failed: " + res.status + " " + errText };
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content !== "string") {
    logTranslate("missing content in choices");
    return { error: "Translation failed: empty model response" };
  }

  logTranslate("raw content length", content.length);
  const cleaned = stripJsonFences(content);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    logTranslate("JSON parse error", parseErr);
    return { parseFailed: true };
  }

  if (!validateLessonJson(parsed)) {
    logTranslate("validation failed", parsed);
    return { parseFailed: true };
  }

  return { ok: true, parsed: parsed };
}

async function handleTranslate(sourcePhrase, lessonDirection) {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return "Translation failed: missing OpenAI API key. Open LinguaWatch popup and save your API key.";
  }
  const direction = lessonDirection === "es_to_en" ? "es_to_en" : DEFAULT_LESSON_DIRECTION;
  logTranslate("start", { sourcePhrase, lessonDirection: direction });
  try {
    let result = await fetchLessonJsonOnce(sourcePhrase, direction, false, apiKey);
    if (result.error) {
      return result.error;
    }
    if (result.ok) {
      logTranslate("success");
      return result.parsed;
    }

    logTranslate("retrying after invalid JSON or shape");
    result = await fetchLessonJsonOnce(sourcePhrase, direction, true, apiKey);
    if (result.error) {
      return result.error;
    }
    if (result.ok) {
      logTranslate("success after retry");
      return result.parsed;
    }

    return "Translation failed: invalid JSON from model";
  } catch (err) {
    logTranslate("error", err);
    return "Translation failed: " + (err && err.message ? err.message : String(err));
  }
}

async function handleTts(text, speed) {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return "TTS failed: missing OpenAI API key. Open LinguaWatch popup and save your API key.";
  }
  logTts("start", { textLength: text ? text.length : 0, speed });
  try {
    const body = JSON.stringify({
      model: "tts-1",
      voice: "onyx",
      input: text,
      speed: typeof speed === "number" && speed > 0 ? speed : 1,
    });

    logTts("request sending");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body,
    });

    logTts("response status", res.status);
    if (!res.ok) {
      const errText = await res.text();
      logTts("response not ok", errText);
      return "TTS failed: " + res.status + " " + errText;
    }

    const buf = await res.arrayBuffer();
    logTts("arrayBuffer bytes", buf.byteLength);
    const b64 = arrayBufferToBase64(buf);
    logTts("base64 length", b64.length);
    return b64;
  } catch (err) {
    logTts("error", err);
    return "TTS failed: " + (err && err.message ? err.message : String(err));
  }
}

try {
  if (browser.browserAction && browser.browserAction.setBadgeText) {
    browser.browserAction.setBadgeText({ text: "ON" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#00AA00" });
  }
} catch (e) {
  console.error("[LinguaWatch BG] badge error", e);
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "PING") {
    try {
      sendResponse({ pong: true });
    } catch (e) {
      console.error("[LinguaWatch BG] PING sendResponse error", e);
    }
    return false;
  }

  if (message.type === "TRANSLATE") {
    const sourcePhrase = message.sourcePhrase;
    const lessonDirection = message.lessonDirection;
    (async () => {
      try {
        const result = await handleTranslate(sourcePhrase, lessonDirection);
        sendResponse(result);
      } catch (err) {
        console.error("[LinguaWatch BG TRANSLATE] unhandled", err);
        try {
          sendResponse("Translation failed: " + (err && err.message ? err.message : String(err)));
        } catch (e2) {
          console.error("[LinguaWatch BG] sendResponse error", e2);
        }
      }
    })();
    return true;
  }

  if (message.type === "TTS") {
    const text = message.text;
    const speed = message.speed;
    (async () => {
      try {
        const result = await handleTts(text, speed);
        sendResponse(result);
      } catch (err) {
        console.error("[LinguaWatch BG TTS] unhandled", err);
        try {
          sendResponse("TTS failed: " + (err && err.message ? err.message : String(err)));
        } catch (e2) {
          console.error("[LinguaWatch BG] sendResponse error", e2);
        }
      }
    })();
    return true;
  }

  if (message.type === "METRIC_EVENT") {
    const eventType = message.eventType;
    const payload = message.payload || {};
    (async () => {
      if (eventType === "lesson_shown") {
        await incrementMetric("lessonsShown");
      } else if (eventType === "lesson_completed") {
        await incrementMetric("lessonsCompleted");
      } else if (eventType === "lesson_error") {
        await incrementMetric("lessonsErrored");
      } else if (eventType === "bad_translation_report") {
        await incrementMetric("badTranslationReports");
        await addBadTranslationReport(payload);
      }
      try {
        sendResponse({ ok: true });
      } catch (e) {
        console.warn("[LinguaWatch BG METRICS] sendResponse failed", e);
      }
    })();
    return true;
  }

  return false;
});
