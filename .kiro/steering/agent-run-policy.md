# Agent run policy

## Never run the Scraping Agent unless explicitly asked

Do not run the Scraping Agent, or anything that triggers it, unless the user asks for it
in that specific request. A general instruction like "run the pipeline", "refresh the
data" or "try it end to end" is **not** permission to scrape.

Why: every scrape spends real Apify credit against a metered account, and that account
has already hit its monthly hard limit once (`403 actor-disabled` at $7.15 against a $5
cap). Scraped posts also change the downstream keyword ranking, so an unasked-for scrape
silently invalidates results the user is reasoning about.

### Commands and paths that DO scrape — require explicit permission

| Path | Effect |
|---|---|
| `npm run agent:scrape` | Scraping Agent standalone |
| `POST /api/pipeline/run` | Full pipeline, stage 1 is scraping |
| `runDiscoveryPipeline()` in `server/src/orchestrator.ts` | Same |
| `runAgent('scraping', …)` | Direct invocation |
| Any call to `apify.run`, `apify.fetchHashtagFeed`, `apify.fetchProfilePosts` | Apify actor runs |

### Use these instead — no scraping, no Apify spend

| Need | Use |
|---|---|
| Validation / Analysis output | `npm run agent:assess` — replays a captured scrape from `out/scraper-run.json` |
| Existing scrape results | `out/scraper-run.json`, `out/assess-run.json`, `out/analysis-agent-output.json` |
| Keyword or hashtag data | The `keywords`, `hashtags`, `keyword_signals` tables |
| Corpus embeddings | `npm run corpus:embed` (Vertex only, no Apify) |
| Web knowledge | `npm run kb:web-research` (Parallel + Vertex, no Apify) |
| Retrieval | `npm run corpus:retrieve`, `POST /api/corpus/retrieve` |

### If scraping genuinely looks necessary

Say so and stop. Name what you would run, the expected Apify actor-run count, and wait
for the user to confirm. Do not run a "small" scrape to check something — a
`--max-keywords 1` run still calls a paid actor.

Reading Apify **configuration or status** is fine: `apify.isConfigured()`,
`apify.verifyActors()`, and the `integrations.apify` block of `/api/health` cost nothing.
