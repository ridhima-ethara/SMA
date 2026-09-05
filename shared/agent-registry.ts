// THE AGENT REGISTRY — the single source of truth.
// No agent and no skill exists that is not declared here. Every tunable value is a described knob.

export type StageId = 'discover' | 'assess' | 'plan' | 'create' | 'ship' | 'learn'
export type AgentId =
  | 'scraping' | 'validation' | 'analysis' | 'calendar' | 'caption' | 'image'
  | 'review' | 'knowledge' | 'publishing' | 'analytics' | 'learning'

export type ConfigType = 'number' | 'percent' | 'boolean' | 'enum' | 'text'

export interface ConfigField {
  key: string
  label: string
  type: ConfigType
  default: string | number | boolean
  description: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: string[]
}

export interface SkillSpec {
  id: string
  agentId: AgentId
  section?: string
  name: string
  summary: string
  inputs: string[]
  outputs: string[]
  config: ConfigField[]
  order: number
  enabledByDefault: boolean
  critical?: boolean
}

export interface AgentSpec {
  id: AgentId
  name: string
  shortName: string
  stage: StageId
  role: string
  description: string
  consumes: string[]
  produces: string[]
  handsOffTo: AgentId[]
  sections?: string[]
}

export interface StageSpec {
  id: StageId
  name: string
  order: number
  description: string
  agentIds: AgentId[]
}

export type SkillConfigValues = Record<string, string | number | boolean>

const num = (key: string, label: string, def: number, description: string, min?: number, max?: number, step = 1, unit?: string): ConfigField =>
  ({ key, label, type: 'number', default: def, description, min, max, step, unit })
const pct = (key: string, label: string, def: number, description: string): ConfigField =>
  ({ key, label, type: 'percent', default: def, description, min: 0, max: 100, step: 1, unit: '%' })
const bool = (key: string, label: string, def: boolean, description: string): ConfigField =>
  ({ key, label, type: 'boolean', default: def, description })
const en = (key: string, label: string, options: string[], def: string, description: string): ConfigField =>
  ({ key, label, type: 'enum', default: def, description, options })

export const STAGES: StageSpec[] = [
  { id: 'discover', name: 'Discover', order: 1, description: 'Scrape LinkedIn for movement on the keyword set.', agentIds: ['scraping'] },
  { id: 'assess', name: 'Assess', order: 2, description: 'Validate what is genuinely trending and cluster it into opportunities.', agentIds: ['validation', 'analysis'] },
  { id: 'plan', name: 'Plan', order: 3, description: 'Place opportunities on the weekly calendar.', agentIds: ['calendar'] },
  { id: 'create', name: 'Create', order: 4, description: 'Write, illustrate and review every post.', agentIds: ['caption', 'image', 'review'] },
  { id: 'ship', name: 'Ship', order: 5, description: 'Publish approved posts and record receipts.', agentIds: ['publishing'] },
  { id: 'learn', name: 'Learn', order: 6, description: 'Measure, research and write what was learned back into the Knowledge Base.', agentIds: ['analytics', 'knowledge', 'learning'] },
]

export const AGENTS: AgentSpec[] = [
  { id: 'scraping', name: 'Scraping Agent', shortName: 'Scraping', stage: 'discover', role: 'Discovers movement on the keyword set', description: 'Runs the keyword set against LinkedIn through the Apify actors, harvests hashtags from what it finds, and re-scrapes the strongest hashtag feeds for an unbiased volume reading.', consumes: ['keywords', 'sources', 'competitors'], produces: ['scraped_items', 'hashtag_candidates', 'keyword_signals'], handsOffTo: ['validation'] },
  { id: 'validation', name: 'Validation Agent', shortName: 'Validation', stage: 'assess', role: 'Ranks what is trending and issues verdicts', description: 'Scores every keyword for trend, ranks each trending keyword\'s hashtags, and passes every candidate through the four-verdict gate: validated, needs_review, duplicate or rejected.', consumes: ['scraped_items', 'hashtag_candidates', 'keyword_signals'], produces: ['trending_keywords', 'validated_hashtags', 'review_queue'], handsOffTo: ['analysis'] },
  { id: 'analysis', name: 'Analysis Agent', shortName: 'Analysis', stage: 'assess', role: 'Clusters signal into content opportunities', description: 'Clusters validated signal into ranked content opportunities, predicts engagement, proposes angles and formats, and emits the consolidated top-25 hashtag set.', consumes: ['validated_items', 'validated_hashtags', 'competitor_posts'], produces: ['opportunities', 'top_hashtags'], handsOffTo: ['calendar'] },
  { id: 'calendar', name: 'Calendar & Ideas Agent', shortName: 'Calendar', stage: 'plan', role: 'Places opportunities on the weekly calendar', description: 'Turns opportunities into content ideas, picks the best day, time and platform for each with evidence, and applies the top-10-per-platform rule so the calendar stays focused.', consumes: ['opportunities', 'knowledge_entries'], produces: ['content_ideas', 'calendar_slots'], handsOffTo: ['caption'], sections: ['ideas', 'scheduling'] },
  { id: 'caption', name: 'Caption Creator Agent', shortName: 'Caption', stage: 'create', role: 'Writes platform-specific copy from the Knowledge Base', description: 'Reads the Knowledge Base, then writes the nine-stage caption through Gemini when configured or the deterministic template writer when not. Brand voice enforcement is always the final step.', consumes: ['content_ideas', 'knowledge_entries'], produces: ['drafts'], handsOffTo: ['image'], sections: ['caption'] },
  { id: 'image', name: 'Image Creator Agent', shortName: 'Image', stage: 'create', role: 'Illustrates every post with a brand-safe creative', description: 'Composites an optional model-painted background under a vector brand layer that is always drawn locally. No model is ever asked to draw brand text.', consumes: ['drafts', 'content_ideas'], produces: ['media_assets'], handsOffTo: ['review'], sections: ['image'] },
  { id: 'review', name: 'Review Agent', shortName: 'Review', stage: 'create', role: 'Applies human edits and checks brand compliance', description: 'Applies edit instructions (the human always wins), runs the 20-rule brand check, and offers learnable preferences back to the Knowledge Base.', consumes: ['drafts', 'media_assets', 'instructions'], produces: ['revised_drafts', 'compliance_findings', 'preferences'], handsOffTo: ['knowledge', 'publishing'] },
  { id: 'knowledge', name: 'Knowledge Agent', shortName: 'Knowledge', stage: 'learn', role: 'Owns the Knowledge Base', description: 'Researches the top 25 hashtags against the live web through Parallel every Sunday at 06:00 (and on demand), writing cited, confidence-scored entries that every other agent reads before it acts.', consumes: ['top_hashtags', 'outcomes'], produces: ['knowledge_entries', 'knowledge_builds'], handsOffTo: ['caption', 'image', 'calendar', 'review'] },
  { id: 'publishing', name: 'Publishing Agent', shortName: 'Publishing', stage: 'ship', role: 'Publishes approved posts and records receipts', description: 'Validates the format, uploads media, dispatches through the platform adapter and records a permanent receipt stamped with demo or live mode.', consumes: ['approved_ideas', 'drafts', 'media_assets'], produces: ['posts', 'receipts'], handsOffTo: ['analytics'] },
  { id: 'analytics', name: 'Analytics Agent', shortName: 'Analytics', stage: 'learn', role: 'Measures every post against its own baseline', description: 'Ingests metrics, computes the account\'s trailing baseline, compares each post to it, detects anomalies and explains the result in plain language.', consumes: ['posts', 'post_metrics'], produces: ['post_analysis', 'recommendations'], handsOffTo: ['learning'] },
  { id: 'learning', name: 'Learning Agent', shortName: 'Learning', stage: 'learn', role: 'Turns outcomes and edits into durable knowledge', description: 'Detects patterns in human edit instructions and post outcomes, writes them back as knowledge, and raises or lowers confidence as evidence accumulates or contradicts.', consumes: ['post_analysis', 'feedback', 'decisions'], produces: ['knowledge_entries'], handsOffTo: ['knowledge'] },
]

export const SKILLS: SkillSpec[] = [
  // ── SCRAPING ──────────────────────────────────────────────────────────
  { id: 'scraping.keyword.resolve', agentId: 'scraping', name: 'Resolve keyword set', summary: 'Loads the active keywords, sorts them by weight, slices to the run limit and expands synonyms.', inputs: ['keywords'], outputs: ['resolvedKeywords'], order: 1, enabledByDefault: true, critical: true, config: [
    num('maxKeywordsPerRun', 'Max keywords per run', 12, 'How many of the highest-weighted active keywords are scraped in one run.', 1, 40),
    pct('minWeight', 'Minimum weight', 40, 'Keywords below this weight are skipped even if active.'),
    bool('expandSynonyms', 'Expand synonyms', true, 'Adds synonym variants (e.g. RL for reinforcement learning) to each keyword query.'),
  ] },
  { id: 'scraping.source.connect', agentId: 'scraping', name: 'Connect to sources', summary: 'Verifies Apify is configured and its LinkedIn actors are reachable; stops the run with the reason when they are not.', inputs: ['resolvedKeywords'], outputs: ['mode', 'sources', 'unreachable'], order: 2, enabledByDefault: true, critical: true, config: [
    num('maxParallel', 'Max parallel actors', 4, 'How many Apify actor runs are in flight at once.', 1, 12),
    bool('failIfNoSource', 'Fail if no source', true, 'A run with no reachable live source fails with the reason. There is no fabricated fallback data.'),
  ] },
  { id: 'scraping.linkedin.fetch', agentId: 'scraping', name: 'Fetch LinkedIn posts', summary: 'Calls the Apify posts actor for each keyword and normalises the dataset into RawPost records.', inputs: ['resolvedKeywords', 'mode'], outputs: ['rawPosts'], order: 3, enabledByDefault: true, critical: true, config: [
    num('maxItemsPerKeyword', 'Max items per keyword', 50, 'Upper bound on posts pulled for one keyword query.', 5, 200, 5),
    en('datePosted', 'Date window', ['past-24h', 'past-week', 'past-month'], 'past-week', 'How far back the LinkedIn search reaches.'),
    en('sortBy', 'Sort by', ['relevance', 'date'], 'date', 'Whether LinkedIn returns the most relevant or most recent posts first.'),
    num('retries', 'Retries', 2, 'Retries with exponential backoff before that keyword is skipped for this run.', 0, 5),
    num('minAuthorFollowers', 'Min author followers', 0, 'Posts from authors below this follower count are dropped.', 0, 100000, 100),
  ] },
  { id: 'scraping.hashtag.harvest', agentId: 'scraping', name: 'Harvest hashtags', summary: 'Extracts every #tag from the scraped bodies, counts posts and engagement per tag, drops generic tags.', inputs: ['rawPosts'], outputs: ['hashtagCandidates'], order: 4, enabledByDefault: true, critical: true, config: [
    num('minOccurrences', 'Min occurrences', 2, 'A tag must appear in at least this many posts to become a candidate.', 1, 20),
    bool('dropGeneric', 'Drop generic tags', true, 'Removes the 16 reach-bait tags (#ai, #tech, #innovation…) from the candidates.'),
    num('maxPerKeyword', 'Max per keyword', 25, 'Cap on hashtag candidates kept per keyword.', 5, 100),
  ] },
  { id: 'scraping.hashtag.expand', agentId: 'scraping', name: 'Expand hashtag feeds', summary: 'Re-scrapes the top harvested hashtags through the hashtag actor for an independent volume reading.', inputs: ['hashtagCandidates'], outputs: ['hashtagCandidates'], order: 5, enabledByDefault: true, config: [
    num('expandTop', 'Expand top N', 15, 'How many of the strongest harvested hashtags get their own feed scraped.', 0, 50),
    num('itemsPerHashtag', 'Items per hashtag', 25, 'Posts pulled from each hashtag feed.', 5, 100, 5),
    bool('enabled', 'Enabled', true, 'Switch the feed expansion on or off without disabling the skill.'),
  ] },
  { id: 'scraping.engagement.capture', agentId: 'scraping', name: 'Capture engagement', summary: 'Normalises engagement to 0–100 against the batch max and computes velocity per hour.', inputs: ['rawPosts'], outputs: ['rawPosts'], order: 6, enabledByDefault: true, config: [
    bool('normalise', 'Normalise', true, 'Rescale raw engagement to 0–100 relative to the strongest post in the batch.'),
    num('velocityWindowHours', 'Velocity window', 72, 'Hours since posting used as the denominator for engagement velocity.', 6, 336, 6, 'h'),
  ] },
  { id: 'scraping.competitor.track', agentId: 'scraping', name: 'Track competitors', summary: 'Scrapes the configured competitor pages and tags each post with format and engagement index.', inputs: ['competitors'], outputs: ['competitorPosts'], order: 7, enabledByDefault: true, config: [
    en('tier', 'Competitor tier', ['P0 only', 'P0+P1', 'All'], 'P0+P1', 'Which competitor tiers are tracked this run.'),
    num('postsPerCompetitor', 'Posts per competitor', 3, 'Most recent posts pulled per competitor page.', 1, 20),
  ] },
  { id: 'scraping.dedupe.prefilter', agentId: 'scraping', name: 'Pre-filter duplicates', summary: 'Drops posts whose external id or URL was already captured within the history window.', inputs: ['rawPosts', 'history'], outputs: ['rawPosts'], order: 8, enabledByDefault: true, config: [
    num('historyDays', 'History window', 14, 'Days of prior captures compared against.', 1, 90, 1, 'd'),
  ] },

  // ── VALIDATION ────────────────────────────────────────────────────────
  { id: 'validation.keyword.trend', agentId: 'validation', name: 'Score keyword trend', summary: 'Scores every keyword on volume, engagement, velocity and growth against prior runs, and picks the top trending set.', inputs: ['rawPosts', 'keywordHistory'], outputs: ['keywordSignals', 'trendingKeywords'], order: 1, enabledByDefault: true, critical: true, config: [
    num('topKeywords', 'Top keywords', 5, 'How many keywords are marked trending this run.', 1, 20),
    pct('volumeWeight', 'Volume weight', 25, 'Share of the trend score from post volume. The four weights should sum to 100.'),
    pct('engagementWeight', 'Engagement weight', 35, 'Share of the trend score from total engagement.'),
    pct('velocityWeight', 'Velocity weight', 20, 'Share of the trend score from engagement per hour.'),
    pct('growthWeight', 'Growth weight', 20, 'Share of the trend score from growth against the prior-run average.'),
    num('trendWindowRuns', 'Trend window', 4, 'How many prior runs form the baseline for growth.', 1, 12, 1, 'runs'),
    num('minPostsToRank', 'Min posts to rank', 3, 'Keywords with fewer posts this run are not ranked.', 1, 50),
  ] },
  { id: 'validation.hashtag.rank', agentId: 'validation', name: 'Rank hashtags per keyword', summary: 'Scores each trending keyword\'s hashtags on relevance, engagement, volume and recency and keeps the top set.', inputs: ['hashtagCandidates', 'trendingKeywords'], outputs: ['rankedHashtags'], order: 2, enabledByDefault: true, critical: true, config: [
    num('topHashtagsPerKeyword', 'Top hashtags per keyword', 5, 'How many hashtags are kept for each trending keyword.', 1, 20),
    num('freshnessHalfLifeHours', 'Freshness half-life', 72, 'Hours after which a hashtag\'s recency component halves.', 6, 720, 6, 'h'),
  ] },
  { id: 'validation.credibility.score', agentId: 'validation', name: 'Score credibility', summary: 'Source-tier base score with a trusted-source bonus and community penalty, re-deriving the label from the score.', inputs: ['candidates'], outputs: ['candidates.credibility'], order: 3, enabledByDefault: true, critical: true, config: [
    num('trustedBonus', 'Trusted-source bonus', 15, 'Points added when the source is on the trusted list.', 0, 40),
    num('communityPenalty', 'Community penalty', 10, 'Points removed for community-type sources.', 0, 40),
  ] },
  { id: 'validation.relevance.score', agentId: 'validation', name: 'Score relevance', summary: 'Topic overlap against the brand topics can only push relevance up. Threads the thresholds onto the payload.', inputs: ['candidates'], outputs: ['candidates.relevance'], order: 4, enabledByDefault: true, critical: true, config: [
    pct('acceptThreshold', 'Accept threshold', 70, 'Relevance at or above this is validated outright.'),
    pct('rejectThreshold', 'Reject threshold', 40, 'Relevance below this is rejected.'),
  ] },
  { id: 'validation.freshness.score', agentId: 'validation', name: 'Score freshness', summary: 'Exponential decay from the posting time: 100 · 0.5^(ageHours / halfLife).', inputs: ['candidates'], outputs: ['candidates.freshness'], order: 5, enabledByDefault: true, config: [
    num('halfLifeHours', 'Half-life', 72, 'Hours after which freshness halves.', 6, 720, 6, 'h'),
  ] },
  { id: 'validation.duplicate.detect', agentId: 'validation', name: 'Detect duplicates', summary: 'Exact, near (Dice bigram) and semantic-alias passes. Duplicates are linked to their original, never deleted.', inputs: ['candidates', 'history'], outputs: ['candidates.duplicateOf'], order: 6, enabledByDefault: true, critical: true, config: [
    pct('similarityThreshold', 'Similarity threshold', 62, 'Dice similarity at or above this marks a near-duplicate.'),
    num('compareWindow', 'Compare window', 30, 'Days of prior validated items compared against.', 1, 180, 1, 'd'),
    bool('withinBatch', 'Compare within batch', true, 'Also compares each candidate against the others in this run.'),
    bool('aliasMapEnabled', 'Alias map', true, 'Treats known aliases (#RL ≡ #ReinforcementLearning) as duplicates.'),
  ] },
  { id: 'validation.verdict.route', agentId: 'validation', name: 'Route verdicts', summary: 'Strict priority: duplicate → rejected → needs_review (low credibility or uncertain) → validated. Every branch names its evidence.', inputs: ['candidates'], outputs: ['verdicts', 'bucketCounts'], order: 7, enabledByDefault: true, critical: true, config: [
    bool('escalateUncertain', 'Escalate uncertain', true, 'Uncertain items go to the human queue instead of being rejected.'),
    bool('lowCredibilityAlwaysReviews', 'Low credibility always reviews', true, 'Low-credibility items always get a human look even when relevant.'),
  ] },
  { id: 'validation.review.queue', agentId: 'validation', name: 'Materialise review queue', summary: 'Writes every needs_review item into the human queue with the reason and the exact decision requested.', inputs: ['verdicts'], outputs: ['reviewQueue'], order: 8, enabledByDefault: true, config: [
    num('maxQueueSize', 'Max queue size', 40, 'Cap on open review items created per run; the rest wait for the next run.', 5, 200),
  ] },

  // ── ANALYSIS ──────────────────────────────────────────────────────────
  { id: 'analysis.trend.cluster', agentId: 'analysis', name: 'Cluster trends', summary: 'Greedy clustering of validated items by title similarity into content opportunities.', inputs: ['validatedItems'], outputs: ['clusters'], order: 1, enabledByDefault: true, critical: true, config: [
    pct('mergeThreshold', 'Merge threshold', 45, 'Items at or above this similarity join the same cluster.'),
    num('maxClusters', 'Max clusters', 24, 'Upper bound on opportunities produced per run.', 3, 100),
  ] },
  { id: 'analysis.brand.fit', agentId: 'analysis', name: 'Score brand fit', summary: 'Scores each cluster against the brand domains and topics.', inputs: ['clusters'], outputs: ['clusters.brandRelevance'], order: 2, enabledByDefault: true, critical: true, config: [
    pct('minBrandFit', 'Minimum brand fit', 45, 'Clusters below this fit are not turned into opportunities.'),
  ] },
  { id: 'analysis.engagement.predict', agentId: 'analysis', name: 'Predict engagement', summary: 'Predicts an engagement level from source engagement, velocity and brand fit.', inputs: ['clusters'], outputs: ['clusters.engagementLevel'], order: 3, enabledByDefault: true, config: [
    pct('velocityInfluence', 'Velocity influence', 30, 'Share of the prediction driven by velocity rather than absolute engagement.'),
  ] },
  { id: 'analysis.format.recommend', agentId: 'analysis', name: 'Recommend format', summary: 'Recommends Thought Leadership, Carousel, Short Post, Video or Case Study per cluster.', inputs: ['clusters'], outputs: ['clusters.format'], order: 4, enabledByDefault: true, config: [
    en('preferredFormat', 'Preferred format', ['Auto', 'Thought Leadership', 'Carousel', 'Short Post', 'Video', 'Case Study'], 'Auto', 'Force a format or let the agent pick from the evidence.'),
  ] },
  { id: 'analysis.angle.propose', agentId: 'analysis', name: 'Propose angle', summary: 'Writes a research-lab angle and target audience for each opportunity.', inputs: ['clusters'], outputs: ['clusters.angle', 'clusters.audience'], order: 5, enabledByDefault: true, config: [
    en('stance', 'Stance', ['Explain the mechanism', 'Challenge the consensus', 'Report the evidence'], 'Explain the mechanism', 'Default rhetorical stance for proposed angles.'),
  ] },
  { id: 'analysis.competitor.compare', agentId: 'analysis', name: 'Compare with competitors', summary: 'Notes which competitors are already posting on each cluster and how well it performed for them.', inputs: ['clusters', 'competitorPosts'], outputs: ['clusters.competitorNote'], order: 6, enabledByDefault: true, config: [
    num('lookbackDays', 'Lookback', 14, 'Days of competitor posts considered.', 1, 90, 1, 'd'),
  ] },
  { id: 'analysis.hashtag.consolidate', agentId: 'analysis', name: 'Consolidate top hashtags', summary: 'Merges the per-keyword top hashtags, de-duplicates across keywords, re-ranks globally and emits the top set.', inputs: ['rankedHashtags'], outputs: ['topHashtags'], order: 7, enabledByDefault: true, critical: true, config: [
    num('topHashtags', 'Top hashtags', 25, 'Size of the consolidated global set sent to the Knowledge Agent.', 5, 100),
  ] },
  { id: 'analysis.recommendation.explain', agentId: 'analysis', name: 'Explain recommendations', summary: 'Writes a plain-language explanation for every opportunity naming the evidence.', inputs: ['clusters'], outputs: ['opportunities'], order: 8, enabledByDefault: true, critical: true, config: [
    num('maxSentences', 'Max sentences', 3, 'Length cap on each explanation.', 1, 6),
  ] },

  // ── CALENDAR ──────────────────────────────────────────────────────────
  { id: 'calendar.idea.form', agentId: 'calendar', section: 'ideas', name: 'Form ideas', summary: 'Turns each opportunity into a titled, described content idea.', inputs: ['opportunities'], outputs: ['ideas'], order: 1, enabledByDefault: true, critical: true, config: [
    num('maxIdeasPerRun', 'Max ideas per run', 40, 'Upper bound on ideas produced in one pipeline run.', 3, 120),
  ] },
  { id: 'calendar.idea.dedupe', agentId: 'calendar', section: 'ideas', name: 'De-duplicate ideas', summary: 'Drops ideas too similar to ones already on the calendar.', inputs: ['ideas', 'existingIdeas'], outputs: ['ideas'], order: 2, enabledByDefault: true, config: [
    pct('similarityThreshold', 'Similarity threshold', 60, 'Ideas at or above this similarity to an existing idea are dropped.'),
  ] },
  { id: 'calendar.slot.optimize', agentId: 'calendar', section: 'scheduling', name: 'Optimise slot', summary: 'Ranks an hour-weight table inside the preferred window, spreads deterministically, attaches four evidence-bearing slot reasons.', inputs: ['ideas'], outputs: ['ideas.date', 'ideas.time', 'ideas.slotReasons'], order: 3, enabledByDefault: true, critical: true, config: [
    num('preferredWindowStart', 'Window start', 8, 'Earliest posting hour (24h).', 0, 23, 1, 'h'),
    num('preferredWindowEnd', 'Window end', 18, 'Latest posting hour (24h).', 1, 23, 1, 'h'),
    bool('avoidWeekends', 'Avoid weekends', true, 'Never place a post on Saturday or Sunday.'),
    num('horizonDays', 'Horizon', 14, 'How many days ahead ideas are spread across.', 3, 60, 1, 'd'),
  ] },
  { id: 'calendar.platform.select', agentId: 'calendar', section: 'scheduling', name: 'Select platform', summary: 'Format × platform fit matrix with a tie-break toward the primary platform; alternates above the threshold are kept.', inputs: ['ideas'], outputs: ['ideas.platform', 'ideas.altPlatforms', 'ideas.confidence'], order: 4, enabledByDefault: true, critical: true, config: [
    en('primaryPlatform', 'Primary platform', ['linkedin', 'instagram', 'x'], 'linkedin', 'Platform that wins ties.'),
    pct('alternateThreshold', 'Alternate threshold', 60, 'Platforms scoring at or above this are offered as alternates.'),
  ] },
  { id: 'calendar.cadence.balance', agentId: 'calendar', section: 'scheduling', name: 'Balance cadence', summary: 'Limits posts per day and per platform so the week is not front-loaded.', inputs: ['ideas'], outputs: ['ideas'], order: 5, enabledByDefault: true, config: [
    num('maxPerDay', 'Max per day', 4, 'Maximum ideas placed on any single day.', 1, 12),
    num('maxPerPlatformPerDay', 'Max per platform per day', 2, 'Maximum ideas on one platform on one day.', 1, 6),
  ] },
  { id: 'calendar.conflict.detect', agentId: 'calendar', section: 'scheduling', name: 'Detect conflicts', summary: 'Flags ideas placed within the minimum gap of another on the same platform.', inputs: ['ideas'], outputs: ['ideas.conflicts'], order: 6, enabledByDefault: true, config: [
    num('minGapHours', 'Minimum gap', 3, 'Hours required between two posts on the same platform.', 1, 24, 1, 'h'),
  ] },
  { id: 'calendar.crossplatform.adapt', agentId: 'calendar', section: 'scheduling', name: 'Adapt across platforms', summary: 'Notes how each idea should adapt if moved to an alternate platform.', inputs: ['ideas'], outputs: ['ideas.adaptNotes'], order: 7, enabledByDefault: true, config: [
    bool('suggestAlternates', 'Suggest alternates', true, 'Attach adaptation notes for every alternate platform.'),
  ] },
  { id: 'calendar.rank.select', agentId: 'calendar', section: 'scheduling', name: 'Rank and select (top 10 per platform)', summary: 'Ranks every idea by priority score and, per platform, keeps the top N on the calendar. The rest become suggestions.', inputs: ['ideas'], outputs: ['ideas.priorityScore', 'ideas.platformRank', 'ideas.calendarSlot'], order: 8, enabledByDefault: true, critical: true, config: [
    num('topPerPlatform', 'Top per platform', 10, 'How many ideas per platform take a calendar slot; the rest go to More suggestions.', 1, 30),
    pct('rankConfidenceWeight', 'Confidence weight', 45, 'Share of the priority score from the idea\'s confidence.'),
    pct('rankRelevanceWeight', 'Relevance weight', 35, 'Share of the priority score from brand relevance.'),
    pct('rankTrendWeight', 'Trend weight', 20, 'Share of the priority score from the trend score.'),
    bool('balanceAcrossPlatforms', 'Balance across platforms', true, 'Rank each platform independently so no platform starves.'),
  ] },

  // ── CAPTION ───────────────────────────────────────────────────────────
  { id: 'generation.caption.mode', agentId: 'caption', section: 'caption', name: 'Choose writer', summary: 'Picks Gemini when GCP is configured, otherwise the deterministic template writer.', inputs: ['idea'], outputs: ['writer', 'source'], order: 1, enabledByDefault: true, critical: true, config: [
    en('preferredWriter', 'Preferred writer', ['Auto', 'Gemini', 'Template'], 'Auto', 'Force a writer or let configuration decide.'),
  ] },
  { id: 'generation.caption.voice', agentId: 'caption', section: 'caption', name: 'Ground in the Knowledge Base', summary: 'Retrieves Knowledge Base entries for the idea\'s hashtag and topic; they become the grounding for the model call.', inputs: ['idea', 'knowledge_entries'], outputs: ['grounding'], order: 2, enabledByDefault: true, critical: true, config: [
    num('maxEntries', 'Max entries', 8, 'How many Knowledge Base entries are passed to the writer.', 1, 30),
    bool('requireGrounding', 'Require grounding', false, 'Raise a compliance finding when no entry is retrieved.'),
  ] },
  { id: 'generation.caption.hook', agentId: 'caption', section: 'caption', name: 'Write hook', summary: 'One declarative sentence, at most 18 words, stating a finding.', inputs: ['grounding'], outputs: ['hook'], order: 3, enabledByDefault: true, critical: true, config: [
    en('hookPattern', 'Hook pattern', ['Finding', 'Contrast', 'Question', 'Number'], 'Finding', 'Which hook pattern the template writer uses.'),
  ] },
  { id: 'generation.caption.problem', agentId: 'caption', section: 'caption', name: 'State the problem', summary: 'Context and problem stages.', inputs: ['grounding'], outputs: ['problem'], order: 4, enabledByDefault: true, critical: true, config: [
    num('maxSentences', 'Max sentences', 2, 'Length cap on the problem stage.', 1, 4),
  ] },
  { id: 'generation.caption.explanation', agentId: 'caption', section: 'caption', name: 'Explain the mechanism', summary: 'Reframe, mechanism, evidence and implication. Calls Gemini when configured.', inputs: ['grounding', 'hook', 'problem'], outputs: ['explanation'], order: 5, enabledByDefault: true, critical: true, config: [
    pct('temperature', 'Creativity', 60, 'Sampling temperature for the model writer, as a percent.'),
    num('maxOutputTokens', 'Max output tokens', 2048, 'Token budget for the model call.', 256, 8192, 256),
    bool('citeEvidence', 'Cite evidence', true, 'Name the source behind every figure in the evidence stage.'),
  ] },
  { id: 'generation.caption.close', agentId: 'caption', section: 'caption', name: 'Write the close', summary: 'Ethara connection and a closing line or question.', inputs: ['explanation'], outputs: ['close'], order: 6, enabledByDefault: true, critical: true, config: [
    en('closeStyle', 'Close style', ['Question', 'Observation'], 'Question', 'End on a question or on a declarative observation.'),
  ] },
  { id: 'generation.caption.hashtags', agentId: 'caption', section: 'caption', name: 'Derive hashtags', summary: 'Topic-derived tags, never generic. The 3–5 ceiling is brand policy and cannot be raised.', inputs: ['idea'], outputs: ['hashtags'], order: 7, enabledByDefault: true, config: [
    num('count', 'Hashtag count', 4, 'Preferred number of hashtags between the brand minimum of 3 and maximum of 5.', 3, 5),
  ] },
  { id: 'generation.caption.adapt', agentId: 'caption', section: 'caption', name: 'Adapt to platform', summary: 'Compresses for X, restructures for Instagram, keeps LinkedIn long-form.', inputs: ['caption', 'platform'], outputs: ['caption'], order: 8, enabledByDefault: true, critical: true, config: [
    num('xMaxChars', 'X max characters', 280, 'Hard cap for the X version.', 140, 280, 10),
    num('instagramMaxChars', 'Instagram max characters', 1200, 'Soft cap for the Instagram version.', 300, 2200, 50),
  ] },
  { id: 'generation.caption.variants', agentId: 'caption', section: 'caption', name: 'Generate variants', summary: 'Produces alternate hooks for A/B consideration.', inputs: ['caption'], outputs: ['variants'], order: 9, enabledByDefault: false, config: [
    num('variantCount', 'Variant count', 2, 'How many alternate hooks are produced.', 1, 5),
  ] },
  { id: 'generation.caption.sourceLink', agentId: 'caption', section: 'caption', name: 'Attach source link', summary: 'Appends the strongest cited source URL when the platform supports it.', inputs: ['caption', 'grounding'], outputs: ['caption'], order: 10, enabledByDefault: false, config: [
    bool('linkedinOnly', 'LinkedIn only', true, 'Only attach links on LinkedIn where they do not cost reach.'),
  ] },

  // ── IMAGE ─────────────────────────────────────────────────────────────
  { id: 'generation.image.approach', agentId: 'image', section: 'image', name: 'Choose approach', summary: 'Picks a concept and decides whether a model paints the background.', inputs: ['idea', 'caption'], outputs: ['concept', 'approach'], order: 1, enabledByDefault: true, critical: true, config: [
    en('preferredModel', 'Preferred model', ['Auto', 'brand-svg', 'imagen-4', 'gemini-flash-image', 'z-image-turbo'], 'Auto', 'Which renderer paints the background when reachable.'),
  ] },
  { id: 'generation.image.reference', agentId: 'image', section: 'image', name: 'Pull references', summary: 'Notes recent creatives to avoid near-duplicate visuals.', inputs: ['media_assets'], outputs: ['references'], order: 2, enabledByDefault: true, config: [
    num('lookback', 'Lookback', 10, 'Recent creatives compared against.', 1, 50),
  ] },
  { id: 'generation.image.template', agentId: 'image', section: 'image', name: 'Pick template', summary: 'Chooses the canvas and the layout for the platform.', inputs: ['platform'], outputs: ['canvas', 'layout'], order: 3, enabledByDefault: true, config: [
    en('layout', 'Layout', ['Auto', 'Headline left', 'Headline centre'], 'Auto', 'Where the headline block sits on the canvas.'),
  ] },
  { id: 'generation.image.tokens', agentId: 'image', section: 'image', name: 'Apply brand tokens', summary: 'Headline, kicker, accent bar, logomark, footer — always drawn locally.', inputs: ['caption'], outputs: ['brandLayer'], order: 4, enabledByDefault: true, critical: true, config: [
    num('headlineMaxWords', 'Headline max words', 10, 'The headline restates the hook and is cut at this many words.', 4, 16),
  ] },
  { id: 'generation.image.render', agentId: 'image', section: 'image', name: 'Render', summary: 'Composites the optional painted background under the vector brand layer.', inputs: ['brandLayer', 'concept'], outputs: ['dataUri', 'fallbackReason'], order: 5, enabledByDefault: true, critical: true, config: [
    num('variants', 'Variants', 1, 'How many variants of the field are rendered.', 1, 4),
  ] },
  { id: 'generation.image.export', agentId: 'image', section: 'image', name: 'Export', summary: 'Stores the asset with its canvas metadata.', inputs: ['dataUri'], outputs: ['media_asset'], order: 6, enabledByDefault: true, config: [
    en('format', 'Format', ['svg', 'png'], 'svg', 'Stored format; PNG requires a rasteriser at export time.'),
  ] },
  { id: 'generation.image.altText', agentId: 'image', section: 'image', name: 'Write alt text', summary: 'Descriptive alt text naming the concept and headline.', inputs: ['brandLayer'], outputs: ['altText'], order: 7, enabledByDefault: true, config: [
    num('maxChars', 'Max characters', 200, 'Alt text length cap.', 60, 400, 10),
  ] },
  { id: 'generation.image.reviewGate', agentId: 'image', section: 'image', name: 'Review gate', summary: 'Checks the visual rules (12–16) before the asset is attached.', inputs: ['media_asset'], outputs: ['visualCheck'], order: 8, enabledByDefault: true, critical: true, config: [
    bool('blockOnFailure', 'Block on failure', true, 'Refuse to attach an asset that breaks a visual rule.'),
  ] },
  { id: 'generation.image.video.compose', agentId: 'image', section: 'image', name: 'Compose video brief', summary: 'Writes a brief for a short video variant. Disabled by default.', inputs: ['caption'], outputs: ['videoBrief'], order: 9, enabledByDefault: false, config: [
    num('durationSeconds', 'Duration', 20, 'Target video length.', 6, 60, 1, 's'),
  ] },

  // ── REVIEW ────────────────────────────────────────────────────────────
  { id: 'review.instruction.apply', agentId: 'review', name: 'Apply instruction', summary: 'Applies the human edit instruction. The human always wins; a compliance finding is raised alongside, never silently resolved.', inputs: ['draft', 'instruction'], outputs: ['draft', 'note'], order: 1, enabledByDefault: true, critical: true, config: [
    bool('humanWins', 'Human wins', true, 'Human instructions override brand guidelines (the finding is still raised).'),
  ] },
  { id: 'review.compliance.check', agentId: 'review', name: 'Check compliance', summary: 'Runs the 20-rule brand check and reports the verdict and dimensions.', inputs: ['draft', 'media_asset'], outputs: ['compliance'], order: 2, enabledByDefault: true, critical: true, config: [
    bool('attachCorrectedVersion', 'Attach corrected version', true, 'Attach a corrected version when every violation is mechanical.'),
  ] },
  { id: 'review.preference.extract', agentId: 'review', name: 'Extract preference', summary: 'Turns a repeated instruction into a candidate Knowledge Base preference offered to the human.', inputs: ['instruction'], outputs: ['preference'], order: 3, enabledByDefault: true, config: [
    bool('askBeforeSaving', 'Ask before saving', true, 'Offer "Save this preference?" instead of writing it automatically.'),
  ] },
  { id: 'review.diff.summarize', agentId: 'review', name: 'Summarise diff', summary: 'Writes a one-line summary of what changed.', inputs: ['before', 'after'], outputs: ['diffSummary'], order: 4, enabledByDefault: true, config: [
    num('maxChars', 'Max characters', 160, 'Length cap on the summary.', 40, 400, 10),
  ] },

  // ── KNOWLEDGE ─────────────────────────────────────────────────────────
  { id: 'knowledge.hashtag.select', agentId: 'knowledge', name: 'Select hashtags', summary: 'Reads the current top hashtags and skips any researched recently unless forced.', inputs: ['topHashtags'], outputs: ['researchSet'], order: 1, enabledByDefault: true, critical: true, config: [
    num('hashtagCount', 'Hashtag count', 25, 'How many top hashtags are researched per build.', 1, 100),
    num('recencyDays', 'Recency window', 5, 'Hashtags researched within this many days are skipped.', 0, 60, 1, 'd'),
    bool('forceRefresh', 'Force refresh', false, 'Research every hashtag even if researched recently.'),
  ] },
  { id: 'knowledge.research.search', agentId: 'knowledge', name: 'Research via Parallel', summary: 'Builds a research objective per hashtag and calls Parallel Web Systems.', inputs: ['researchSet'], outputs: ['researchResults'], order: 2, enabledByDefault: true, critical: true, config: [
    num('maxParallel', 'Max parallel', 4, 'Hashtags researched concurrently.', 1, 12),
    num('windowDays', 'Window', 14, 'How far back the research objective looks.', 1, 90, 1, 'd'),
    en('processor', 'Processor', ['base', 'pro', 'ultra'], 'base', 'Parallel processor tier.'),
    num('maxResults', 'Max results', 10, 'Results requested per hashtag.', 1, 30),
    num('retries', 'Retries', 2, 'Retries before that hashtag is skipped for this build.', 0, 5),
  ] },
  { id: 'knowledge.research.extract', agentId: 'knowledge', name: 'Extract entries', summary: 'Turns result sets into candidate entries. An entry with too few cited sources is discarded.', inputs: ['researchResults'], outputs: ['candidateEntries'], order: 3, enabledByDefault: true, critical: true, config: [
    num('minSources', 'Minimum sources', 2, 'Cited URLs required for an entry to enter the Knowledge Base.', 1, 5),
    num('maxChars', 'Max characters', 900, 'Content length cap per entry.', 200, 3000, 50),
    num('maxEntriesPerHashtag', 'Max entries per hashtag', 3, 'Entries kept per hashtag.', 1, 10),
  ] },
  { id: 'knowledge.entry.upsert', agentId: 'knowledge', name: 'Upsert entries', summary: 'Merges into an existing entry above the dedupe threshold (evidence +1, sources unioned, confidence promoted) instead of inserting.', inputs: ['candidateEntries'], outputs: ['written', 'merged'], order: 4, enabledByDefault: true, critical: true, config: [
    pct('dedupeThreshold', 'Dedupe threshold', 72, 'Similarity at or above this merges into the existing entry.'),
  ] },
  { id: 'knowledge.entry.retrieve', agentId: 'knowledge', name: 'Retrieve entries', summary: 'The read path every other agent uses.', inputs: ['query'], outputs: ['entries'], order: 5, enabledByDefault: true, critical: true, config: [
    num('maxResults', 'Max results', 12, 'Entries returned per retrieval.', 1, 50),
    bool('includeInactive', 'Include inactive', false, 'Also return entries switched off in the UI.'),
  ] },
  { id: 'knowledge.entry.rank', agentId: 'knowledge', name: 'Rank entries', summary: 'Confidence rank blended with topic similarity.', inputs: ['entries'], outputs: ['entries'], order: 6, enabledByDefault: true, config: [
    pct('confidenceWeight', 'Confidence weight', 55, 'Share of the ranking from confidence rather than topic similarity.'),
  ] },
  { id: 'knowledge.conflict.resolve', agentId: 'knowledge', name: 'Resolve conflicts', summary: 'Pairs within a category above 55 similarity are resolved by strategy; escalation writes a real review-queue row.', inputs: ['entries'], outputs: ['resolutions'], order: 7, enabledByDefault: true, config: [
    en('strategy', 'Strategy', ['Newest wins', 'Highest confidence wins', 'Escalate to human'], 'Newest wins', 'How conflicting entries are resolved.'),
  ] },
  { id: 'knowledge.priority.tag', agentId: 'knowledge', name: 'Tag priority', summary: 'Boosts priority-tagged entries and optionally demotes untagged ones.', inputs: ['entries'], outputs: ['entries'], order: 8, enabledByDefault: true, config: [
    pct('priorityBoost', 'Priority boost', 25, 'Score boost for entries tagged priority.'),
    bool('demoteUntagged', 'Demote untagged', true, 'Reduce untagged entries by 40%.'),
  ] },

  // ── PUBLISHING ────────────────────────────────────────────────────────
  { id: 'publishing.format.validate', agentId: 'publishing', name: 'Validate format', summary: 'Checks length, hashtags and media against the platform rules.', inputs: ['draft', 'media_asset'], outputs: ['formatCheck'], order: 1, enabledByDefault: true, critical: true, config: [
    bool('requireMedia', 'Require media', true, 'Refuse to publish without a creative.'),
  ] },
  { id: 'publishing.media.upload', agentId: 'publishing', name: 'Upload media', summary: 'Uploads the creative through the platform adapter.', inputs: ['media_asset'], outputs: ['mediaId'], order: 2, enabledByDefault: true, config: [
    num('timeoutMs', 'Timeout', 30000, 'Upload timeout.', 5000, 120000, 1000, 'ms'),
  ] },
  { id: 'publishing.post.dispatch', agentId: 'publishing', name: 'Dispatch post', summary: 'Publishes through the demo or live adapter. Modes are never mixed.', inputs: ['draft', 'mediaId'], outputs: ['externalId'], order: 3, enabledByDefault: true, critical: true, config: [
    num('retries', 'Retries', 1, 'Retries on a transient adapter failure.', 0, 3),
  ] },
  { id: 'publishing.receipt.record', agentId: 'publishing', name: 'Record receipt', summary: 'Writes the post row with a permanent publish-mode stamp and audit history.', inputs: ['externalId'], outputs: ['post'], order: 4, enabledByDefault: true, critical: true, config: [
    bool('seedFirstHour', 'Seed first-hour metrics', true, 'Record an initial metrics pull immediately after publishing (demo mode).'),
  ] },

  // ── ANALYTICS ─────────────────────────────────────────────────────────
  { id: 'analytics.metrics.ingest', agentId: 'analytics', name: 'Ingest metrics', summary: 'Pulls the latest metrics for a post; every pull is a new row.', inputs: ['post'], outputs: ['metrics'], order: 1, enabledByDefault: true, critical: true, config: [
    num('pullIntervalHours', 'Pull interval', 6, 'Hours between metric pulls.', 1, 72, 1, 'h'),
  ] },
  { id: 'analytics.baseline.compute', agentId: 'analytics', name: 'Compute baseline', summary: 'This account\'s own trailing baseline per platform. Never an industry benchmark.', inputs: ['posts'], outputs: ['baseline'], order: 2, enabledByDefault: true, critical: true, config: [
    num('trailingPosts', 'Trailing posts', 10, 'How many recent posts form the baseline.', 3, 50),
  ] },
  { id: 'analytics.performance.compare', agentId: 'analytics', name: 'Compare performance', summary: 'Compares each reported metric to the baseline; unreported metrics are excluded, never zero.', inputs: ['metrics', 'baseline'], outputs: ['comparison'], order: 3, enabledByDefault: true, critical: true, config: [
    pct('strongThreshold', 'Strong threshold', 20, 'Percent above baseline that counts as strong.'),
  ] },
  { id: 'analytics.anomaly.detect', agentId: 'analytics', name: 'Detect anomalies', summary: 'Flags metrics far outside the baseline band.', inputs: ['comparison'], outputs: ['anomalies'], order: 4, enabledByDefault: true, config: [
    num('sigma', 'Sigma', 2, 'Standard deviations from the baseline that count as an anomaly.', 1, 4, 0.5),
  ] },
  { id: 'analytics.timing.analyze', agentId: 'analytics', name: 'Analyse timing', summary: 'Relates performance to posting day and hour.', inputs: ['posts'], outputs: ['timingInsight'], order: 5, enabledByDefault: true, config: [
    num('minSamples', 'Min samples', 3, 'Posts required per slot before a timing insight is stated.', 1, 20),
  ] },
  { id: 'analytics.format.analyze', agentId: 'analytics', name: 'Analyse format', summary: 'Relates performance to content format.', inputs: ['posts'], outputs: ['formatInsight'], order: 6, enabledByDefault: true, config: [
    num('minSamples', 'Min samples', 3, 'Posts required per format before a format insight is stated.', 1, 20),
  ] },
  { id: 'analytics.insight.explain', agentId: 'analytics', name: 'Explain insight', summary: 'Plain-language summary naming the evidence.', inputs: ['comparison', 'anomalies'], outputs: ['summary'], order: 7, enabledByDefault: true, critical: true, config: [
    num('maxSentences', 'Max sentences', 3, 'Length cap on the summary.', 1, 6),
  ] },
  { id: 'analytics.recommendation.write', agentId: 'analytics', name: 'Write recommendation', summary: 'One concrete recommendation for the next post.', inputs: ['summary'], outputs: ['recommendation'], order: 8, enabledByDefault: true, critical: true, config: [
    en('focus', 'Focus', ['Auto', 'Timing', 'Format', 'Topic'], 'Auto', 'What the recommendation should prioritise.'),
  ] },

  // ── LEARNING ──────────────────────────────────────────────────────────
  { id: 'learning.edit.pattern', agentId: 'learning', name: 'Detect edit patterns', summary: 'Finds repeated human edit instructions across drafts.', inputs: ['feedback'], outputs: ['patterns'], order: 1, enabledByDefault: true, critical: true, config: [
    num('minRepeats', 'Min repeats', 2, 'How often an instruction must recur before it becomes a pattern.', 1, 10),
  ] },
  { id: 'learning.outcome.attribute', agentId: 'learning', name: 'Attribute outcomes', summary: 'Links post performance back to the choices that produced it.', inputs: ['post_analysis'], outputs: ['attributions'], order: 2, enabledByDefault: true, config: [
    pct('minLift', 'Minimum lift', 15, 'Percent above baseline required before an outcome is attributed.'),
  ] },
  { id: 'learning.knowledge.write', agentId: 'learning', name: 'Write knowledge', summary: 'Writes patterns and attributions back as Knowledge Base entries.', inputs: ['patterns', 'attributions'], outputs: ['knowledge_entries'], order: 3, enabledByDefault: true, critical: true, config: [
    en('defaultConfidence', 'Default confidence', ['Low', 'Medium', 'High'], 'Medium', 'Confidence assigned to a newly learned entry.'),
  ] },
  { id: 'learning.confidence.adjust', agentId: 'learning', name: 'Adjust confidence', summary: 'Raises confidence after confirmations and lowers it after contradictions.', inputs: ['knowledge_entries', 'outcomes'], outputs: ['knowledge_entries'], order: 4, enabledByDefault: true, critical: true, config: [
    num('promoteAfter', 'Promote after', 3, 'Confirmations required to raise confidence one level.', 1, 10),
    num('demoteAfter', 'Demote after', 2, 'Contradictions required to lower confidence one level.', 1, 10),
  ] },
]

// ── Derived structures (computed, never hardcoded) ──────────────────────
export const AGENT_BY_ID: Record<AgentId, AgentSpec> = Object.fromEntries(AGENTS.map((a) => [a.id, a])) as Record<AgentId, AgentSpec>
export const STAGE_BY_ID: Record<StageId, StageSpec> = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageSpec>
export const SKILL_BY_ID: Record<string, SkillSpec> = Object.fromEntries(SKILLS.map((s) => [s.id, s]))
export const SKILLS_BY_AGENT: Record<AgentId, SkillSpec[]> = Object.fromEntries(
  AGENTS.map((a) => [a.id, SKILLS.filter((s) => s.agentId === a.id).sort((x, y) => x.order - y.order)]),
) as Record<AgentId, SkillSpec[]>
export const AGENT_ORDER: AgentId[] = AGENTS.map((a) => a.id)

export function defaultSkillConfig(id: string): SkillConfigValues {
  const spec = SKILL_BY_ID[id]
  if (!spec) return {}
  return Object.fromEntries(spec.config.map((f) => [f.key, f.default]))
}

export const REGISTRY_SUMMARY = {
  agents: AGENTS.length,
  skills: SKILLS.length,
  stages: STAGES.length,
  knobs: SKILLS.reduce((n, s) => n + s.config.length, 0),
}

/** Validates the registry at import time: every field described, every id unique, every hand-off resolvable. */
export function validateRegistry(): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const s of SKILLS) {
    if (ids.has(s.id)) problems.push(`duplicate skill id ${s.id}`)
    ids.add(s.id)
    if (!AGENT_BY_ID[s.agentId]) problems.push(`skill ${s.id} references unknown agent ${s.agentId}`)
    for (const f of s.config) if (!f.description) problems.push(`skill ${s.id} field ${f.key} has no description`)
  }
  for (const a of AGENTS) for (const h of a.handsOffTo) if (!AGENT_BY_ID[h]) problems.push(`agent ${a.id} hands off to unknown ${h}`)
  return problems
}
