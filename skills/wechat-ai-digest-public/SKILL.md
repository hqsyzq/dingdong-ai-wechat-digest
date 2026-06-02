---
name: wechat-ai-digest-public
description: Use when maintaining or extending an open-source Cloudflare Worker that generates AI news digests for a WeChat Official Account, including source collection, freshness filtering, WeChat draft creation, article rendering, deployment, and troubleshooting. This public skill uses generic placeholders and must not contain private project paths, account-specific URLs, or secrets.
metadata:
  short-description: Maintain an open-source WeChat AI digest worker
---

# WeChat AI Digest Public Skill

Use this skill for open-source forks of the WeChat AI digest Worker.

## Scope

- Cloudflare Worker that collects AI news and creates WeChat Official Account drafts.
- OpenAI-compatible LLM generation.
- WeChat-compatible HTML rendering.
- Freshness filtering and recent-draft deduplication.
- Source inspection and deployment troubleshooting.

This public skill must stay generic. Do not add private local paths, account names, Worker URLs, API keys, access tokens, or user-specific deployment shortcuts.

## Repository Layout

Expected files:

- `index.js`: Worker routes, cron handler, source fetching, LLM calls, WeChat API calls
- `article-renderer.js`: Markdown to WeChat-compatible HTML
- `wrangler.toml`: Worker config and cron
- `renderer-smoke-test.mjs`: renderer smoke test
- `README.md`: setup and operating guide

## Safety Rules

- Never print or commit secrets.
- Use `wrangler secret put` for:
  - `WECHAT_APP_ID`
  - `WECHAT_APP_SECRET`
  - `THUMB_MEDIA_ID`
  - `SHARED_SECRET`
  - `LLM_API_KEY`
- Keep `.wrangler/`, `.env`, logs, screenshots, and local configuration ignored.
- Draft generation consumes LLM tokens.
- Source inspection and deployment checks do not consume LLM tokens.
- Keep `AUTO_PUBLISH = "false"` unless the WeChat account has freepublish permission.

## Workflow

1. Inspect the relevant files before editing.
2. Prefer code-side validation and filtering over prompt-only fixes.
3. Run:

```bash
npm run check
```

4. Deploy:

```bash
npx wrangler deploy
```

5. For manual generation, call `POST /generate` with `draftOnly: true`.

## Protected Endpoints

All protected endpoints require JSON body field `secret`, matching `SHARED_SECRET`.

- `POST /generate`: generate and create a draft; consumes LLM tokens.
- `POST /source-status`: inspect source candidates; no LLM token use.
- `POST /publication-status`: inspect recent drafts/published items; no LLM token use.
- `POST /model-info`: inspect configured provider/model without exposing keys.
- `POST /debug`: check whether required environment variables exist.
- `POST /publish-existing`: attempt to publish an existing draft by `media_id`.

## Content Policy

- Include China domestic AI news when relevant domestic candidates exist.
- Prefer official, policy, company, and industry sources over generic media rewrites.
- Avoid repeated stories from recent drafts.
- Source lines should be concrete and verifiable, preferably direct URLs.
- Avoid generic source labels such as only `Source`, `X`, `Twitter`, or a platform name.

## Freshness

Before calling the LLM:

- Fetch recent WeChat drafts.
- Extract previous titles, digest text, body text, and URLs.
- Normalize titles and canonicalize URLs.
- Filter incoming candidates already used in recent drafts.
- Report raw and filtered counts in `source-status`.

If stale stories still appear, strengthen code-side filtering first.

## WeChat Rendering

WeChat mobile strips or weakens many CSS effects. Prefer:

- simple HTML tags
- inline styles
- explicit margins
- `background-color` over complex CSS effects

Avoid relying on external CSS, pseudo-elements, or `text-align: justify`.

## Common Failures

- `Too many subrequests by single Worker invocation`: reduce source count, mirror retries, or external page fetches.
- `Unauthorized`: check `SHARED_SECRET`.
- `48001 api unauthorized`: account lacks publish/freepublish permission; draft creation may still work.
- No domestic news: inspect `source-status`, then adjust domestic source routes or filtering.
- Repeated old topics: improve URL canonicalization, title normalization, or recent-draft window size.
