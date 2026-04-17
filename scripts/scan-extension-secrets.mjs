import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const targets = [
  path.join(root, "public", "downloads", "LinguaWatch-firefox"),
  path.join(root, "..", "LinguaWatch", "extension", "firefox"),
];

const files = [
  "background.js",
  "popup.js",
  "content-script.js",
  "manifest.json",
  "popup.html",
  "popup.css",
  "overlay.css",
];

const forbiddenPatterns = [
  /sk-proj-[A-Za-z0-9_\-]+/g,
  /OPENAI_API_KEY\s*=\s*["'`][^"'`]+["'`]/g,
  /INSERT_KEY_HERE/g,
];

async function main() {
  let failures = 0;
  for (const target of targets) {
    for (const f of files) {
      const p = path.join(target, f);
      let content = "";
      try {
        content = await readFile(p, "utf8");
      } catch {
        continue;
      }
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          failures += 1;
          console.error("Forbidden secret marker in " + p + " via pattern " + pattern);
        }
      }
    }
  }
  if (failures > 0) {
    console.error("Secret scan failed with " + failures + " issue(s).");
    process.exit(1);
  }
  console.log("Secret scan passed.");
}

main().catch((err) => {
  console.error("Secret scan fatal:", err && err.message ? err.message : String(err));
  process.exit(1);
});
