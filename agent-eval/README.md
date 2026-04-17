# Agent Eval Harness

This harness runs a quick quality check of translation lesson JSON output for:

- English -> Spanish (LATAM)
- Spanish (LATAM) -> English

## What it tests

- JSON shape validity
- Required fields exist and are non-empty
- `wordBreakdown` has <= 6 entries
- Basic language signal checks (lightweight heuristic)
- Counts pass/fail and prints a report

## Environment variables

- `OPENAI_API_KEY` (required)
- `EVAL_MODEL` (optional, default: `gpt-4o-mini`)

## Run

```bash
npm run eval:agent
```

Golden scoring run:

```bash
npm run eval:golden
```

Extension secret scan:

```bash
npm run scan:secrets
```

## Notes

- This is a fast smoke test, not a linguistic gold-standard eval.
- Extend `cases.en-es.json` as you collect real subtitle examples and failures.
