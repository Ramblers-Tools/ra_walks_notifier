# RA Walks Notifier — Request Access Form Worker

Cloudflare Worker backing the "Request access" form on the marketing site
(`gh-pages` branch of this repo, `rawalksnotifier.ramblers.tools`). The page
POSTs `{ name, group, email, marketingOptIn }` to this Worker, which emails
the request via the SMTP2GO API. The SMTP2GO API key never reaches the
browser — it's stored only as an encrypted Worker secret.

This project was reconstructed from the Worker's live source on
2026-07-24 (it had previously only existed as a Quick Edit in the
Cloudflare dashboard, with no local project or version control). The
deployed script name is `little-mouse-a924` (matching the existing
`https://little-mouse-a924.me-e89.workers.dev/` URL the marketing site
already calls) — deploying from here updates that same Worker, it does
not create a new one.

## One-time setup

```bash
npm install
npx wrangler login
```

Before your first `deploy` from this project, open the **existing** Worker
in the Cloudflare dashboard (Workers & Pages -> `little-mouse-a924` ->
Settings -> Variables) and copy the current `TO_EMAIL` and `FROM_EMAIL`
values into `wrangler.toml`'s `[vars]` section. Deploying with placeholder
values would overwrite the live configuration.

Then set the one secret (not stored in `wrangler.toml` — secrets are
encrypted and managed separately):

```bash
npx wrangler secret put SMTP2GO_API_KEY
```

## Local development

```bash
npm run dev
```

This runs the Worker locally via `wrangler dev`. You'll need a
`.dev.vars` file (gitignored, never committed) with a real or test
`SMTP2GO_API_KEY` to actually send email locally:

```
SMTP2GO_API_KEY=your-key-here
```

## Deploying

```bash
npm run deploy
```

Publishes to the existing `little-mouse-a924.me-e89.workers.dev` Worker.

## Useful commands

- `npm run tail` — stream live logs from the deployed Worker (handy for
  debugging a failed form submission without waiting for an email that
  never arrives).
- `npm run secrets` — list which secrets are currently set (not their
  values).
