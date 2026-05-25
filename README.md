# LinguaWatch Home

Website and beta landing app for LinguaWatch.

## Local development

In the project directory, run:

- `npm install`
- `npm start`

Then open `http://localhost:3000`.

## Scripts

- `npm start` - run the app locally
- `npm test` - run tests
- `npm run build` - create production build in `build/`

## API key safety (important)

- Never paste private API keys into this repo's source files.
- Never commit real keys into `.env`, `.env.*`, JavaScript files, or HTML files.
- This frontend is public at runtime; client-side secrets can be extracted.

### Where to put your OpenAI key for LinguaWatch beta

For testing the extension, put your key in the extension popup UI:

1. Load the Firefox extension.
2. Click the LinguaWatch toolbar icon.
3. Paste your OpenAI key into the **OpenAI API key** field.
4. Save in the popup.

That stores the key in extension storage for local testing instead of hardcoding it in the website.

## Environment files

- Use `.env.example` as a template for safe placeholder values only.
- `.env` and `.env.*` are ignored by git in this project.
