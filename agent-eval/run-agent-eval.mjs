import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EVAL_MODEL = process.env.EVAL_MODEL || "gpt-4o-mini";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY environment variable.");
  process.exit(1);
}

function buildSystemPrompt(direction) {
  if (direction === "es_to_en") {
    return [
      "You are a language tutor.",
      "Input is Latin American Spanish. Output target language is English.",
      "Return ONLY valid JSON object with keys:",
      "translation, wordBreakdown, grammarNote, exampleSource, exampleTarget.",
      "wordBreakdown is array of objects with sourceText and targetText.",
      "Max 6 breakdown entries. No markdown fences.",
    ].join(" ");
  }
  return [
    "You are a language tutor.",
    "Input is English. Output target language is Latin American Spanish.",
    "Return ONLY valid JSON object with keys:",
    "translation, wordBreakdown, grammarNote, exampleSource, exampleTarget.",
    "wordBreakdown is array of objects with sourceText and targetText.",
    "Max 6 breakdown entries. No markdown fences.",
  ].join(" ");
}

function cleanJson(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

function hasLikelySpanish(text) {
  const lower = String(text || "").toLowerCase();
  return /[áéíóúñ¿¡]|\\b(el|la|los|las|que|de|para|con|está|estoy|quiero|puedo)\\b/i.test(lower);
}

function hasLikelyEnglish(text) {
  const lower = String(text || "").toLowerCase();
  return /\b(the|and|is|are|for|with|this|that|can|will|have|been)\b/i.test(lower);
}

function validateShape(obj) {
  if (!obj || typeof obj !== "object") return "not an object";
  if (typeof obj.translation !== "string" || !obj.translation.trim()) return "missing translation";
  if (!Array.isArray(obj.wordBreakdown)) return "wordBreakdown not array";
  if (obj.wordBreakdown.length > 6) return "wordBreakdown too long";
  for (const row of obj.wordBreakdown) {
    if (!row || typeof row.sourceText !== "string" || typeof row.targetText !== "string") {
      return "invalid wordBreakdown row";
    }
  }
  if (typeof obj.grammarNote !== "string" || !obj.grammarNote.trim()) return "missing grammarNote";
  if (typeof obj.exampleSource !== "string" || !obj.exampleSource.trim()) return "missing exampleSource";
  if (typeof obj.exampleTarget !== "string" || !obj.exampleTarget.trim()) return "missing exampleTarget";
  return null;
}

function validateDirectionHeuristic(direction, obj) {
  if (direction === "en_to_es") {
    if (!hasLikelySpanish(obj.translation)) return "translation does not look Spanish";
    if (!hasLikelySpanish(obj.exampleTarget)) return "exampleTarget does not look Spanish";
    if (!hasLikelyEnglish(obj.exampleSource)) return "exampleSource does not look English";
    return null;
  }
  if (!hasLikelyEnglish(obj.translation)) return "translation does not look English";
  if (!hasLikelyEnglish(obj.exampleTarget)) return "exampleTarget does not look English";
  if (!hasLikelySpanish(obj.exampleSource)) return "exampleSource does not look Spanish";
  return null;
}

async function callModel(caseItem) {
  const body = {
    model: EVAL_MODEL,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(caseItem.direction),
      },
      {
        role: "user",
        content:
          "Return JSON only for this phrase. direction=" +
          caseItem.direction +
          " phrase=" +
          caseItem.sourcePhrase,
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("API " + res.status + ": " + txt);
  }

  const data = await res.json();
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content || ""
    : "";
}

async function main() {
  const casesPath = path.join(__dirname, "cases.en-es.json");
  const raw = await readFile(casesPath, "utf8");
  const cases = JSON.parse(raw);

  const results = [];
  for (const c of cases) {
    const out = { id: c.id, direction: c.direction, ok: false, error: null };
    try {
      const responseText = await callModel(c);
      const parsed = JSON.parse(cleanJson(responseText));
      const shapeErr = validateShape(parsed);
      if (shapeErr) {
        out.error = shapeErr;
      } else {
        const dirErr = validateDirectionHeuristic(c.direction, parsed);
        if (dirErr) out.error = dirErr;
        else out.ok = true;
      }
    } catch (err) {
      out.error = err && err.message ? err.message : String(err);
    }
    results.push(out);
    const status = out.ok ? "PASS" : "FAIL";
    console.log(status + " " + out.id + (out.error ? " - " + out.error : ""));
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const passRate = results.length ? ((passed / results.length) * 100).toFixed(1) : "0.0";

  console.log("\n=== Agent Eval Summary ===");
  console.log("Model: " + EVAL_MODEL);
  console.log("Cases: " + results.length);
  console.log("Passed: " + passed);
  console.log("Failed: " + failed);
  console.log("Pass rate: " + passRate + "%");

  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log("- " + r.id + ": " + r.error);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err && err.message ? err.message : String(err));
  process.exit(1);
});
