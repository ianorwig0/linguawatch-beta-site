/* global browser */

const OPENAI_API_KEY = "INSERT_KEY_HERE";

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

function buildLocaleBlock(targetLanguage) {
  const lang = typeof targetLanguage === "string" ? targetLanguage.toLowerCase() : "es";
  if (lang === "es" || lang.startsWith("es-")) {
    return [
      "LOCALE (Spanish): Write ALL Spanish output in natural Latin American Spanish.",
      "Use neutral LATAM conversational Spanish (not Spain): avoid vosotros/vosotras; use ustedes for plural 'you' where needed.",
      "Prefer vocabulary and phrasing common in Latin America when a word could be Spain-specific vs LATAM (e.g. ordenador vs computadora — prefer LATAM).",
      "Match the register of the English (casual vs formal); do not add slang unless the source is informal.",
      "translation, wordBreakdown[].spanish, and exampleEs must all follow the same locale consistently.",
    ].join(" ");
  }
  return "Use natural target-language Spanish consistent with the user's language setting.";
}

function buildTranslateSystemPrompt(targetLanguage) {
  const locale = buildLocaleBlock(targetLanguage);
  return [
    "You are a fun, conversational Spanish language tutor.",
    locale,
    "Given an English phrase from a YouTube video, respond ONLY with a valid JSON object containing exactly these fields:",
    "translation (Spanish string, faithful to meaning in context — natural, not word-for-word if unnatural),",
    "wordBreakdown (array of objects each with english and spanish string fields, one per key word, maximum 6 words; Spanish must match the same locale as translation),",
    "grammarNote (one simple grammar rule this phrase demonstrates, plain English, under 30 words),",
    "exampleEs (one new example sentence in Spanish using the same grammar rule; same locale as translation),",
    "exampleEn (English translation of exampleEs).",
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
    if (!row || typeof row.english !== "string" || typeof row.spanish !== "string") return false;
  }
  if (
    typeof parsed.grammarNote !== "string" ||
    typeof parsed.exampleEs !== "string" ||
    typeof parsed.exampleEn !== "string"
  ) {
    return false;
  }
  return true;
}

async function fetchLessonJsonOnce(englishPhrase, targetLanguage, strict) {
  const baseSystem = buildTranslateSystemPrompt(targetLanguage);
  const system =
    baseSystem +
    (strict
      ? " Output must be a single raw JSON object only. No markdown fences, no commentary before or after the JSON."
      : "");

  const user = strict
    ? "Output one JSON object with keys translation, wordBreakdown, grammarNote, exampleEs, exampleEn only. Phrase: " +
      englishPhrase
    : "Translate and teach this phrase. Preserve intent and tone. Phrase: " + englishPhrase;

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
      Authorization: "Bearer " + OPENAI_API_KEY,
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

async function handleTranslate(englishPhrase, targetLanguage) {
  logTranslate("start", { englishPhrase, targetLanguage: targetLanguage || "es" });
  try {
    let result = await fetchLessonJsonOnce(englishPhrase, targetLanguage, false);
    if (result.error) {
      return result.error;
    }
    if (result.ok) {
      logTranslate("success");
      return result.parsed;
    }

    logTranslate("retrying after invalid JSON or shape");
    result = await fetchLessonJsonOnce(englishPhrase, targetLanguage, true);
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
        Authorization: "Bearer " + OPENAI_API_KEY,
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
    const englishPhrase = message.englishPhrase;
    const targetLanguage = message.targetLanguage;
    (async () => {
      try {
        const result = await handleTranslate(englishPhrase, targetLanguage);
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

  return false;
});
