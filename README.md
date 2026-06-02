# DingDong.ai WeChat AI Digest

A Cloudflare Worker that collects AI news, asks an OpenAI-compatible LLM to write a Chinese daily digest, renders it as WeChat-compatible HTML, and creates a draft in a WeChat Official Account.

The project was built for `DingDong.ai`, but the code is generic enough to adapt to other WeChat Official Accounts.

## Features

- Daily scheduled generation with Cloudflare Cron Triggers
- WeChat Official Account draft creation
- Optional publish attempt when account permissions allow it
- Overseas AI sources, Hacker News, builder feeds, blogs, China AI/company/policy sources
- Recent-draft deduplication to reduce repeated stories
- WeChat mobile-friendly article renderer
- Protected manual endpoints for generation, source inspection, model inspection, and draft status

## Architecture

```text
Cron or HTTP request
  -> fetch source feeds
  -> filter stale/repeated stories
  -> call OpenAI-compatible chat completions API
  -> render Markdown to WeChat-safe HTML
  -> create WeChat draft
```

## Requirements

- Node.js 18+
- Cloudflare Workers account
- Wrangler
- WeChat Official Account developer credentials
- An OpenAI-compatible LLM API
- A permanent WeChat image material ID for the article cover

## Setup

Install dependencies:

```bash
npm install
```

Set Cloudflare Worker secrets:

```bash
npx wrangler secret put WECHAT_APP_ID
npx wrangler secret put WECHAT_APP_SECRET
npx wrangler secret put THUMB_MEDIA_ID
npx wrangler secret put SHARED_SECRET
npx wrangler secret put LLM_API_KEY
```

Configure non-secret variables in `wrangler.toml` or the Cloudflare dashboard:

```toml
[vars]
AUTO_PUBLISH = "false"
LLM_API_URL = "https://api.openai.com/v1"
LLM_MODEL = "gpt-4.1-mini"
```

`AUTO_PUBLISH` should stay `false` unless your WeChat account has permission for the freepublish APIs.

## Development

Run syntax and renderer smoke checks:

```bash
npm run check
```

Preview renderer output locally:

```bash
npm run preview
```

Deploy:

```bash
npx wrangler deploy
```

## Optional Codex Skill

This repository includes a sanitized public Codex skill at:

```text
skills/wechat-ai-digest-public/
```

It is intended for open-source users and uses generic placeholders only.

If you maintain a private local Codex skill for your own deployment, keep it outside this repository, for example under your personal Codex skills directory. Private skills may contain local paths, account-specific deployment notes, or private operational habits and should not be committed.

## Manual Endpoints

All protected endpoints require JSON body field `secret`, matching `SHARED_SECRET`.

- `POST /generate`
  - `{ "secret": "...", "draftOnly": true }`
  - Generates an article and creates a WeChat draft.
  - Consumes LLM tokens.
- `POST /source-status`
  - Inspects source candidates after freshness/deduplication filtering.
  - Does not call the LLM.
- `POST /publication-status`
  - Lists recent drafts and published items.
  - Does not call the LLM.
- `POST /model-info`
  - Shows configured API URL/model and whether an API key exists.
  - Does not reveal the key.
- `POST /debug`
  - Checks whether required environment variables exist.
  - Does not reveal secret values.
- `POST /publish-existing`
  - Attempts to publish an existing draft by `media_id`.

## Notes On WeChat Permissions

Creating drafts and publishing drafts are different API permissions.

If WeChat returns `48001 api unauthorized` for `freepublish` APIs, the Worker can still create drafts but cannot publish them automatically. In that case, keep `AUTO_PUBLISH = "false"` and publish manually from the WeChat backend.

## Security

- Never commit `.wrangler`, `.env`, `.claude`, local logs, or real secrets.
- Rotate any secret that may have been exposed before publishing.
- Keep `SHARED_SECRET` long and random.
- Treat generated drafts as potentially containing source URLs and editorial output from your model provider.

## License

MIT
