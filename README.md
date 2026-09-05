# Ethara.AI · Social Media Agent

Eleven AI agents in six stages run a complete social-media loop for a frontier-AI research lab: scrape LinkedIn for movement on a keyword set → validate what is genuinely trending → research the winning hashtags into a Knowledge Base (every Sunday 06:00, and on demand) → write and illustrate posts → place them on a weekly calendar (top 10 per platform) → two-stage human approval (Marketing, then Leadership) → publish → measure → learn.

The platform ships with **configuration only** (keyword set, sources, competitors, the 20 brand rules) and no sample content. Scraping calls the Apify LinkedIn actors, research calls Parallel Web Systems; without a key the run stops and says exactly which key is missing — nothing is fabricated.

## Setup (5 commands)

```bash
docker compose up -d postgres          # or use any local PostgreSQL 17 and point DATABASE_URL at it
npm run setup                          # installs web + server deps, creates .env files, migrates, seeds
npm run dev:full                       # API on :4000, web app on :5174
# open http://localhost:5174 — sign in as Marketing or Leadership (any password)
npm run typecheck && npm run lint      # optional: tsc -b + oxlint
```

`npm run setup` copies `.env.example` → `.env` (root and `server/`) when none exists. The server migrates and seeds on boot too, so a fresh database is never empty.

> The Vite dev server runs on **5174** by default (`npm run dev` / `vite.config.ts`). Change it there if you prefer 5173.

## Scripts

| Script | What it does |
|---|---|
| `dev` / `dev:server` / `dev:full` | web only / API only / both (concurrently) |
| `build` | `tsc -b && vite build` |
| `lint` | `oxlint src shared server/src` |
| `typecheck` | web + server type checks |
| `db:migrate` · `db:seed` · `db:reset` | idempotent schema · seed if empty · drop, migrate, seed |
| `setup` | install everything, ensure `.env`, migrate, seed |

## Layout

```
shared/        agent-registry.ts (11 agents · 79 skills · 130 knobs) · brand-voice.ts (20 rules + compliance engine)
               keywords.ts · image-models.ts (brand-layer renderer) · logo-mark.ts
server/src/    index.ts (boot) · api.ts (REST + SSE) · orchestrator.ts · scheduler.ts (node-cron) · events.ts
               db/ (schema.sql, migrate, seed) · integrations/ (apify, parallel, gcp-llm + fixtures) · agents/ (runtime + skills)
src/           React 19 + Zustand store · components/ · pages/ (15 screens) · lib/ (api, ai, image-gen, export) · data/initial.ts (configuration-only initial state)
```

## Environment

All backend keys live in `server/.env` (documented inline in `server/.env.example`; the root `.env` only holds `VITE_API_URL`).

| Key | Needed for |
|---|---|
| `APIFY_API_TOKEN` + the three `APIFY_LINKEDIN_*_ACTOR` ids | **Start scraping** — every pipeline run |
| `PARALLEL_API_KEY` | Knowledge Base build (Sunday cron + Rebuild now) |
| `GCP_API_KEY` / `GCP_SERVICE_ACCOUNT_JSON` | Gemini captions and Imagen backgrounds (optional — the built-in template writer and local brand renderer are used otherwise) |
| `PUBLISH_MODE` | `demo` records receipts without dispatching; `live` needs platform credentials |

Restart the API after editing `server/.env`.

## Key guarantees

- **The agent registry is the single source of truth.** Boot fails if a critical skill has no handler; the UI refuses to disable a critical skill.
- **Nothing publishes without two human approvals.** The API rejects a publish before Leadership approval and a rejection without a reason.
- **Nothing is deleted.** Rejections keep their reason, duplicates link to their original, knowledge entries deactivate, drafts version.
- **Every run is replayable** from `skill_runs.config_used`.
- **No sample data.** `npm run db:reset` restores configuration only; every post, hashtag, idea and metric on screen came from a real run.

## API

`/api/health` · `/api/registry` · `/api/state` · `/api/events` (SSE) · `/api/pipeline/run` · `/api/knowledge/build` · `/api/ideas/:id/{draft,image,instruct,approve,leadership/approve,leadership/reject,publish}` · keywords, hashtags, items, review-queue, lineage, analytics. See `server/src/api.ts`.

Deep links for demos: `?as=marketing|leadership&page=calendar&theme=light&intro=0&theater=1&review=first&kb=1`.
