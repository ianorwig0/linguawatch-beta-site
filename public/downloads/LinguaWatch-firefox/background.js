/* global browser */

function logTranslate(step, detail) {
  console.log("[LinguaWatch BG TRANSLATE]", step, detail !== undefined ? detail : "");
}

function logTts(step, detail) {
  console.log("[LinguaWatch BG TTS]", step, detail !== undefined ? detail : "");
}

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
    "You are a concise Spanish language tutor interrupting a YouTube video at one caption line.",
    locale,
    "You may receive recent caption lines for context. The anchor phrase is the line to teach — everything must explain THAT line, not a generic textbook example.",
    "Respond ONLY with a valid JSON object containing exactly these fields:",
    "translation (Spanish string for the anchor phrase — natural in context, not word-for-word if unnatural),",
    "wordBreakdown (array of objects with english and spanish fields, 3–6 key words from the anchor phrase only; Spanish matches translation locale),",
    "focusWord (object with english and spanish — the single most memorable word from wordBreakdown; must be identical to one wordBreakdown entry),",
    "grammarNote (plain English, under 20 words, zero jargon: name the pattern shown IN the anchor phrase),",
    "exampleEs (one new Spanish sentence reusing the same grammar pattern as the anchor phrase; same locale),",
    "exampleEn (English gloss of exampleEs).",
    "question (beginner-friendly MCQ testing the English meaning of focusWord.spanish only, e.g. 'What does <spanish> mean?'),",
    "correctAnswer (short English meaning of focusWord.spanish),",
    "distractors (array of exactly 2 plausible wrong English options).",
    "Return ONLY the JSON object, no markdown, no backticks, no explanation.",
  ].join(" ");
}

function focusWordMatchesBreakdown(focusWord, wordBreakdown) {
  if (!focusWord || typeof focusWord !== "object") return false;
  const fe = String(focusWord.english || "")
    .trim()
    .toLowerCase();
  const fs = String(focusWord.spanish || "")
    .trim()
    .toLowerCase();
  if (!fe || !fs) return false;
  for (let i = 0; i < wordBreakdown.length; i++) {
    const row = wordBreakdown[i];
    if (
      String(row.english || "")
        .trim()
        .toLowerCase() === fe &&
      String(row.spanish || "")
        .trim()
        .toLowerCase() === fs
    ) {
      return true;
    }
  }
  return false;
}

function ensureFocusWord(parsed) {
  if (!parsed || !Array.isArray(parsed.wordBreakdown) || !parsed.wordBreakdown.length) return false;
  if (focusWordMatchesBreakdown(parsed.focusWord, parsed.wordBreakdown)) return true;
  const first = parsed.wordBreakdown[0];
  if (!first || typeof first.english !== "string" || typeof first.spanish !== "string") return false;
  parsed.focusWord = {
    english: first.english.trim(),
    spanish: first.spanish.trim(),
  };
  return true;
}

function validateLessonJson(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (typeof parsed.translation !== "string" || !parsed.translation.trim()) return false;
  if (!Array.isArray(parsed.wordBreakdown) || parsed.wordBreakdown.length < 2) return false;
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
  if (!ensureFocusWord(parsed)) return false;
  if (typeof parsed.question !== "string" || !parsed.question.trim()) return false;
  if (typeof parsed.correctAnswer !== "string" || !parsed.correctAnswer.trim()) return false;
  if (!Array.isArray(parsed.distractors) || parsed.distractors.length !== 2) return false;
  for (let i = 0; i < parsed.distractors.length; i++) {
    if (typeof parsed.distractors[i] !== "string" || !parsed.distractors[i].trim()) return false;
  }
  return true;
}

function buildTranslateUserMessage(englishPhrase, captionContext, strict) {
  const anchor = String(englishPhrase || "").trim();
  const lines = Array.isArray(captionContext)
    ? captionContext
        .map(function (line) {
          return String(line || "").trim();
        })
        .filter(Boolean)
    : [];

  const contextBlock =
    lines.length > 1
      ? "Recent caption lines from the video (context only):\n" +
        lines
          .map(function (line, idx) {
            return idx + 1 + ". " + line;
          })
          .join("\n") +
        "\n\n"
      : "";

  if (strict) {
    return (
      contextBlock +
      "Output one JSON object with keys translation, wordBreakdown, focusWord, grammarNote, exampleEs, exampleEn, question, correctAnswer, distractors only.\n" +
      "Anchor phrase to teach (explain THIS line only): " +
      anchor
    );
  }

  return (
    contextBlock +
    "Teach the anchor phrase using the caption context when helpful. Anchor phrase: " +
    anchor
  );
}

async function getOpenAiApiKey() {
  try {
    const data = await browser.storage.sync.get({ openaiApiKey: "" });
    const key = normalizeApiKey(data.openaiApiKey);
    return key;
  } catch (err) {
    console.error("[LinguaWatch BG] storage.get openaiApiKey failed", err);
    return "";
  }
}

async function fetchLessonJsonOnce(englishPhrase, targetLanguage, captionContext, strict) {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    return { error: "Translation failed: add your OpenAI API key in the LinguaWatch popup settings." };
  }

  const baseSystem = buildTranslateSystemPrompt(targetLanguage);
  const system =
    baseSystem +
    (strict
      ? " Output must be a single raw JSON object only. No markdown fences, no commentary before or after the JSON."
      : "");

  const user = buildTranslateUserMessage(englishPhrase, captionContext, strict);

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

async function handleTranslate(englishPhrase, targetLanguage, captionContext) {
  logTranslate("start", {
    englishPhrase,
    targetLanguage: targetLanguage || "es",
    contextLines: Array.isArray(captionContext) ? captionContext.length : 0,
  });
  try {
    let result = await fetchLessonJsonOnce(englishPhrase, targetLanguage, captionContext, false);
    if (result.error) {
      return result.error;
    }
    if (result.ok) {
      logTranslate("success");
      return result.parsed;
    }

    logTranslate("retrying after invalid JSON or shape");
    result = await fetchLessonJsonOnce(englishPhrase, targetLanguage, captionContext, true);
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
    const apiKey = await getOpenAiApiKey();
    if (!apiKey) {
      return "TTS failed: add your OpenAI API key in the LinguaWatch popup settings.";
    }

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
    const englishPhrase = message.englishPhrase;
    const targetLanguage = message.targetLanguage;
    const captionContext = message.captionContext;
    (async () => {
      try {
        const result = await handleTranslate(englishPhrase, targetLanguage, captionContext);
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
