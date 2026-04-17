import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EVAL_MODEL = process.env.EVAL_MODEL || "gpt-4o-mini";
const MIN_GOLDEN_SCORE = Number(process.env.MIN_GOLDEN_SCORE || 85);

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY environment variable.");
  process.exit(1);
}

function buildSystemPrompt(direction) {
  if (direction === "es_to_en") {
    return "Input is Latin American Spanish. Return only JSON with: translation, wordBreakdown[{sourceText,targetText}], grammarNote, exampleSource, exampleTarget. Target language is English.";
  }
  return "Input is English. Return only JSON with: translation, wordBreakdown[{sourceText,targetText}], grammarNote, exampleSource, exampleTarget. Target language is Latin American Spanish.";
}

function cleanJson(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  return t.trim();
}

function safeIncludesAny(text, needles) {
  const lower = String(text || "").toLowerCase();
  return needles.some((n) => lower.includes(String(n || "").toLowerCase()));
}

function scoreCase(g, parsed) {
  let score = 100;
  const issues = [];
  if (!parsed || typeof parsed !== "object") {
    return { score: 0, issues: ["invalid JSON object"] };
  }
  if (!parsed.translation || typeof parsed.translation !== "string") {
    score -= 40;
    issues.push("missing translation");
  }
  if (!Array.isArray(parsed.wordBreakdown)) {
    score -= 20;
    issues.push("invalid wordBreakdown");
  }
  if (!parsed.grammarNote || !parsed.exampleSource || !parsed.exampleTarget) {
    score -= 20;
    issues.push("missing lesson fields");
  }
  if (Array.isArray(g.requiredInTranslation) && g.requiredInTranslation.length) {
    if (!safeIncludesAny(parsed.translation, g.requiredInTranslation)) {
      score -= 15;
      issues.push("required translation hints missing");
    }
  }
  if (Array.isArray(g.forbiddenInTranslation) && g.forbiddenInTranslation.length) {
    if (safeIncludesAny(parsed.translation, g.forbiddenInTranslation)) {
      score -= 15;
      issues.push("forbidden translation term used");
    }
  }
  if (Array.isArray(g.requiredExampleTargetHints) && g.requiredExampleTargetHints.length) {
    if (!safeIncludesAny(parsed.exampleTarget, g.requiredExampleTargetHints)) {
      score -= 10;
      issues.push("exampleTarget hint missing");
    }
  }
  return { score: Math.max(0, score), issues };
}

async function callModel(testCase) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(testCase.direction),
        },
        {
          role: "user",
          content: "Return JSON only for direction=" + testCase.direction + " phrase=" + testCase.sourcePhrase,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("API " + res.status + ": " + (await res.text()));
  const data = await res.json();
  return data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content || ""
    : "";
}

async function main() {
  const goldenPath = path.join(__dirname, "golden.en-es.json");
  const cases = JSON.parse(await readFile(goldenPath, "utf8"));
  let totalScore = 0;
  let failed = 0;

  for (const c of cases) {
    let parsed = null;
    let score = 0;
    let issues = [];
    try {
      parsed = JSON.parse(cleanJson(await callModel(c)));
      const result = scoreCase(c, parsed);
      score = result.score;
      issues = result.issues;
    } catch (err) {
      issues = [err && err.message ? err.message : String(err)];
      score = 0;
    }
    totalScore += score;
    const pass = score >= MIN_GOLDEN_SCORE;
    if (!pass) failed += 1;
    console.log((pass ? "PASS" : "FAIL") + " " + c.id + " score=" + score + (issues.length ? " issues=" + issues.join("; ") : ""));
  }

  const avg = cases.length ? totalScore / cases.length : 0;
  console.log("\n=== Golden Eval Summary ===");
  console.log("Model: " + EVAL_MODEL);
  console.log("Cases: " + cases.length);
  console.log("Average score: " + avg.toFixed(1));
  console.log("Threshold per case: " + MIN_GOLDEN_SCORE);
  console.log("Failed cases: " + failed);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err && err.message ? err.message : String(err));
  process.exit(1);
});
