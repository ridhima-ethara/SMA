-- Ethara.AI Social Media Agent — idempotent schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  brand_voice TEXT,
  audience TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Core',
  weight SMALLINT NOT NULL DEFAULT 50 CHECK (weight BETWEEN 0 AND 100),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_ws_term_idx ON keywords (workspace_id, lower(term));

CREATE TABLE IF NOT EXISTS keyword_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  run_id UUID,
  post_count INT NOT NULL DEFAULT 0,
  total_engagement INT NOT NULL DEFAULT 0,
  avg_engagement NUMERIC(10,2) NOT NULL DEFAULT 0,
  velocity NUMERIC(10,2) NOT NULL DEFAULT 0,
  growth_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  trend_score SMALLINT NOT NULL DEFAULT 0 CHECK (trend_score BETWEEN 0 AND 100),
  rank SMALLINT,
  is_trending BOOLEAN NOT NULL DEFAULT false,
  trend_reason TEXT,
  components JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS keyword_signals_ws_captured_idx ON keyword_signals (workspace_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS keyword_signals_kw_captured_idx ON keyword_signals (keyword_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  display_tag TEXT NOT NULL,
  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  run_id UUID,
  post_count INT NOT NULL DEFAULT 0,
  total_engagement INT NOT NULL DEFAULT 0,
  engagement_per_post NUMERIC(10,2) NOT NULL DEFAULT 0,
  relevance SMALLINT NOT NULL DEFAULT 0 CHECK (relevance BETWEEN 0 AND 100),
  credibility TEXT NOT NULL DEFAULT 'Medium' CHECK (credibility IN ('High','Medium','Low')),
  freshness SMALLINT NOT NULL DEFAULT 0 CHECK (freshness BETWEEN 0 AND 100),
  hashtag_score SMALLINT NOT NULL DEFAULT 0 CHECK (hashtag_score BETWEEN 0 AND 100),
  rank SMALLINT,
  validation TEXT NOT NULL DEFAULT 'pending' CHECK (validation IN ('pending','validated','needs_review','duplicate','rejected')),
  verdict_reason TEXT,
  duplicate_of_id UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  in_top_set BOOLEAN NOT NULL DEFAULT false,
  researched_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, tag, run_id)
);
CREATE INDEX IF NOT EXISTS hashtags_ws_validation_idx ON hashtags (workspace_id, validation);
CREATE INDEX IF NOT EXISTS hashtags_ws_top_idx ON hashtags (workspace_id, in_top_set, rank);

CREATE TABLE IF NOT EXISTS sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('linkedin','instagram','x','web')),
  source_type TEXT NOT NULL CHECK (source_type IN ('Social','News','Competitor','Community','Website')),
  url TEXT,
  trusted BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  tier TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS scraped_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  run_id UUID,
  external_id TEXT,
  title TEXT NOT NULL,
  snippet TEXT,
  url TEXT,
  source_name TEXT,
  source_type TEXT,
  author_name TEXT,
  author_headline TEXT,
  author_followers INT NOT NULL DEFAULT 0,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  engagement INT NOT NULL DEFAULT 0,
  reactions INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  reposts INT NOT NULL DEFAULT 0,
  relevance SMALLINT NOT NULL DEFAULT 0 CHECK (relevance BETWEEN 0 AND 100),
  credibility TEXT NOT NULL DEFAULT 'Medium' CHECK (credibility IN ('High','Medium','Low')),
  freshness SMALLINT NOT NULL DEFAULT 0 CHECK (freshness BETWEEN 0 AND 100),
  is_duplicate BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_id UUID REFERENCES scraped_items(id) ON DELETE SET NULL,
  validation TEXT NOT NULL DEFAULT 'pending' CHECK (validation IN ('pending','validated','needs_review','duplicate','rejected')),
  verdict_reason TEXT,
  capture_source TEXT NOT NULL DEFAULT 'fixture' CHECK (capture_source IN ('live','fixture')),
  fallback_reason TEXT,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS scraped_items_ws_scraped_idx ON scraped_items (workspace_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS scraped_items_ws_validation_idx ON scraped_items (workspace_id, validation);

CREATE TABLE IF NOT EXISTS content_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_item_id UUID REFERENCES scraped_items(id) ON DELETE SET NULL,
  hashtag_id UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_topic TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x')),
  alt_platforms JSONB NOT NULL DEFAULT '[]',
  scheduled_date DATE NOT NULL,
  scheduled_time TEXT NOT NULL DEFAULT '10:30 AM',
  confidence SMALLINT NOT NULL DEFAULT 70 CHECK (confidence BETWEEN 0 AND 100),
  priority_score SMALLINT NOT NULL DEFAULT 0 CHECK (priority_score BETWEEN 0 AND 100),
  platform_rank SMALLINT,
  calendar_slot TEXT NOT NULL DEFAULT 'suggestion' CHECK (calendar_slot IN ('primary','suggestion')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','drafted','in_review','pending_leadership','approved','scheduled','published','rejected')),
  analysis JSONB NOT NULL DEFAULT '{}',
  feedback JSONB NOT NULL DEFAULT '[]',
  is_new_trend BOOLEAN NOT NULL DEFAULT false,
  marketing_approved_by TEXT,
  marketing_approved_at TIMESTAMPTZ,
  leadership_decision JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_ideas_ws_date_idx ON content_ideas (workspace_id, scheduled_date);
CREATE INDEX IF NOT EXISTS content_ideas_ws_platform_slot_idx ON content_ideas (workspace_id, platform, calendar_slot, platform_rank);

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES content_ideas(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x')),
  body TEXT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  generated_by TEXT NOT NULL DEFAULT 'caption',
  model TEXT,
  source TEXT NOT NULL DEFAULT 'fixture' CHECK (source IN ('live','fixture')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idea_id, platform)
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idea_id UUID NOT NULL REFERENCES content_ideas(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x')),
  kind TEXT NOT NULL DEFAULT 'single' CHECK (kind IN ('single','carousel')),
  concept TEXT,
  canvas TEXT,
  width INT NOT NULL DEFAULT 1200,
  height INT NOT NULL DEFAULT 627,
  alt_text TEXT,
  render_mode TEXT NOT NULL DEFAULT 'demo' CHECK (render_mode IN ('demo','live')),
  model TEXT NOT NULL DEFAULT 'brand-svg',
  prompt TEXT,
  fallback_reason TEXT,
  data_uri TEXT NOT NULL,
  variants JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idea_id, platform)
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idea_id UUID REFERENCES content_ideas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','failed','scheduled')),
  external_id TEXT,
  publish_mode TEXT NOT NULL DEFAULT 'demo' CHECK (publish_mode IN ('demo','live')),
  published_at DATE,
  history JSONB NOT NULL DEFAULT '[]',
  media_asset_id UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  format TEXT,
  analysis_summary TEXT,
  analysis_recommendation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_ws_published_idx ON posts (workspace_id, published_at DESC);

CREATE TABLE IF NOT EXISTS post_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reach INT,
  impressions INT,
  likes INT,
  comments INT,
  shares INT,
  engagement_rate NUMERIC(5,2)
);
CREATE INDEX IF NOT EXISTS post_metrics_post_captured_idx ON post_metrics (post_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS platform_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','instagram','x')),
  month TEXT NOT NULL,
  label TEXT NOT NULL,
  is_reported BOOLEAN NOT NULL DEFAULT false,
  metrics JSONB NOT NULL DEFAULT '{}',
  daily JSONB NOT NULL DEFAULT '[]',
  UNIQUE (workspace_id, platform, month)
);

CREATE TABLE IF NOT EXISTS knowledge_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  hashtags_researched INT NOT NULL DEFAULT 0,
  entries_written INT NOT NULL DEFAULT 0,
  entries_merged INT NOT NULL DEFAULT 0,
  sources_cited INT NOT NULL DEFAULT 0,
  research_source TEXT CHECK (research_source IN ('live','fixture')),
  fallback_reason TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}',
  error TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'Manual entry',
  sources JSONB NOT NULL DEFAULT '[]',
  hashtag_id UUID REFERENCES hashtags(id) ON DELETE SET NULL,
  hashtag_tag TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  confidence TEXT NOT NULL DEFAULT 'Medium' CHECK (confidence IN ('High','Medium','Low')),
  evidence_count INT NOT NULL DEFAULT 1,
  confirmations INT NOT NULL DEFAULT 0,
  contradictions INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('brand','research','learned','manual')),
  build_id UUID REFERENCES knowledge_builds(id) ON DELETE SET NULL,
  rule_n SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_entries_ws_active_idx ON knowledge_entries (workspace_id, active);

CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, skill_id)
);

CREATE TABLE IF NOT EXISTS agent_state (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','completed','waiting','needs_review','failed')),
  current_task TEXT NOT NULL DEFAULT 'Idle',
  last_run TIMESTAMPTZ,
  processed INT NOT NULL DEFAULT 0,
  success_rate SMALLINT NOT NULL DEFAULT 100,
  PRIMARY KEY (workspace_id, agent_id)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  input_count INT NOT NULL DEFAULT 0,
  output_count INT NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_ws_started_idx ON agent_runs (workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS skill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','skipped','failed')),
  duration_ms INT NOT NULL DEFAULT 0,
  config_used JSONB NOT NULL DEFAULT '{}',
  note TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_runs_ws_started_idx ON skill_runs (workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS skill_runs_ws_skill_started_idx ON skill_runs (workspace_id, skill_id, started_at DESC);

CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','running','warn','error')),
  entity_type TEXT,
  entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_events_ws_created_idx ON activity_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scraped_item','hashtag','knowledge_conflict')),
  entity_id UUID NOT NULL,
  title TEXT,
  reason TEXT NOT NULL,
  decision_requested TEXT NOT NULL,
  options TEXT[] NOT NULL DEFAULT '{Approve,Reject}',
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_queue_ws_resolved_idx ON review_queue (workspace_id, resolved, created_at DESC);

CREATE TABLE IF NOT EXISTS lineage_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id UUID NOT NULL,
  to_type TEXT NOT NULL,
  to_id UUID NOT NULL,
  agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lineage_from_idx ON lineage_edges (from_type, from_id);
CREATE INDEX IF NOT EXISTS lineage_to_idx ON lineage_edges (to_type, to_id);
