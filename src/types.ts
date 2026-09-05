// Frontend types — mirror the API's /state shape exactly.
import type { AgentId, SkillSpec } from '../shared/agent-registry'
import type { BrandCheck, Platform } from '../shared/brand-voice'
import type { ImageModelSpec } from '../shared/image-models'

export type { AgentId, Platform, BrandCheck }
export type Role = 'marketing' | 'leadership'
export type Page = 'dashboard' | 'calendar' | 'published' | 'activity' | 'intelligence' | 'studio' | 'console' | 'settings' | 'leadership' | 'knowledge'
export type Validation = 'pending' | 'validated' | 'needs_review' | 'duplicate' | 'rejected'
export type Credibility = 'High' | 'Medium' | 'Low'
export type IdeaStatus = 'suggested' | 'drafted' | 'in_review' | 'pending_leadership' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type AgentStatus = 'idle' | 'running' | 'completed' | 'waiting' | 'needs_review' | 'failed'
export type Theme = 'dark' | 'light'
export type ApiMode = 'live' | 'standalone'

export interface User { name: string; role: Role; title: string; email: string; initial: string }

export interface Keyword { id: string; term: string; category: string; weight: number; active: boolean; createdAt?: string | null }
export interface KeywordSignal {
  id: string; keywordId: string; term: string; runId: string | null; postCount: number; totalEngagement: number; avgEngagement: number; velocity: number; growthPct: number
  trendScore: number; rank: number | null; isTrending: boolean; trendReason: string; components: { volume?: number; engagement?: number; velocity?: number; growth?: number }; capturedAt: string | null
}
export interface Hashtag {
  id: string; tag: string; displayTag: string; keywordId: string | null; keywordTerm: string | null; runId: string | null; postCount: number; totalEngagement: number; engagementPerPost: number
  relevance: number; credibility: Credibility; freshness: number; hashtagScore: number; rank: number | null; validation: Validation; verdictReason: string | null
  duplicateOfId: string | null; duplicateOfTag: string | null; inTopSet: boolean; researchedAt: string | null; firstSeenAt: string | null; lastSeenAt: string | null; validatedAt: string | null; createdAt: string | null
}
export interface ScrapedItem {
  id: string; externalId: string | null; title: string; snippet: string | null; url: string | null; sourceName: string | null; sourceType: string | null; keyword: string | null; keywordId: string | null
  authorName: string | null; authorHeadline: string | null; authorFollowers: number; hashtags: string[]; engagement: number; reactions: number; comments: number; reposts: number
  relevance: number; credibility: Credibility; freshness: number; isDuplicate: boolean; duplicateOfId: string | null; validation: Validation; verdictReason: string | null
  captureSource: 'live' | 'fixture'; fallbackReason: string | null; postedAt: string | null; scrapedAt: string | null; validatedAt: string | null
}
export interface IdeaAnalysis {
  brandRelevance?: number; trendScore?: number; engagementLevel?: 'High' | 'Medium' | 'Low'; engagementScore?: number; format?: string; bestDay?: string; angle?: string; audience?: string
  hashtag?: string; keyword?: string; slotReasons?: string[]; platformScores?: Partial<Record<Platform, number>>; explanation?: string; competitorNote?: string; adaptNotes?: Partial<Record<Platform, string>>; conflicts?: string[]
}
export interface Draft { id?: string; platform: Platform; body: string; revision: number; generatedBy: string; model: string | null; source: 'live' | 'fixture'; updatedAt?: string | null }
export interface MediaAsset {
  id?: string; platform: Platform; kind: 'single' | 'carousel'; concept: string | null; canvas: string | null; width: number; height: number; altText: string | null
  renderMode: 'demo' | 'live'; model: string; prompt: string | null; fallbackReason: string | null; dataUri: string; variants: string[]; createdAt?: string | null
}
export interface Feedback { instruction: string; at: string; note?: string }
export interface LeadershipDecision { by: string; decision: 'approved' | 'rejected'; reason?: string; at: string }
export interface Idea {
  id: string; sourceItemId: string | null; hashtagId: string | null; hashtag: string | null; title: string; description: string | null; sourceTopic: string | null; platform: Platform
  altPlatforms: Array<{ platform: Platform; score: number }>; date: string; time: string; confidence: number; priorityScore: number; platformRank: number | null
  calendarSlot: 'primary' | 'suggestion'; status: IdeaStatus; analysis: IdeaAnalysis; feedback: Feedback[]; isNewTrend: boolean
  marketingApprovedBy: string | null; marketingApprovedAt: string | null; leadershipDecision: LeadershipDecision | null; createdAt?: string | null; updatedAt?: string | null
  drafts: Partial<Record<Platform, Draft>>; media: Partial<Record<Platform, MediaAsset>>
}
export interface Metrics { reach: number | null; impressions: number | null; likes: number | null; comments: number | null; shares: number | null; engagementRate: number | null; capturedAt?: string | null }
export interface PublishedPost {
  id: string; ideaId: string | null; title: string; platform: Platform; content: string; status: 'published' | 'failed' | 'scheduled'; externalId: string | null; publishMode: 'demo' | 'live'
  publishedAt: string; history: string[]; mediaAssetId: string | null; mediaDataUri: string | null; format: string | null; analysisSummary: string | null; analysisRecommendation: string | null; metrics: Metrics | null; createdAt?: string | null
}
export interface DailyPoint { day: number; reach: number; impressions: number; engagement: number; likes: number; comments: number; shares: number; followers: number }
export interface PlatformMonth {
  platform: Platform; month: string; label: string; isReported: boolean
  metrics: { followers: number; newFollowers: number; reach: number; impressions: number; engagementRate: number; posts: number; likes: number; comments: number; shares: number; profileViews?: number }
  daily: DailyPoint[]
}
export interface KnowledgeSource { title: string; url: string; publishedAt: string; domain?: string }
export interface KnowledgeEntry {
  id: string; title: string; category: string; content: string; source: string; sources: KnowledgeSource[]; hashtagId: string | null; hashtagTag: string | null; tags: string[]
  confidence: Credibility; evidenceCount: number; active: boolean; origin: 'brand' | 'research' | 'learned' | 'manual'; createdAt: string; ruleN?: number | null; buildId?: string | null
}
export interface KnowledgeBuild {
  id: string; trigger: 'cron' | 'manual'; status: 'running' | 'completed' | 'failed'; hashtagsResearched: number; entriesWritten: number; entriesMerged: number; sourcesCited: number
  researchSource: 'live' | 'fixture' | null; fallbackReason: string | null; startedAt: string | null; finishedAt: string | null; summary: Record<string, unknown>; error: string | null; nextBuildAt: string
}
export interface AgentState { id: AgentId; status: AgentStatus; currentTask: string; lastRun: string | null; processed: number; successRate: number }
export interface ActivityEvent { id: string; agentId: AgentId | 'system'; message: string; status: 'ok' | 'running' | 'warn' | 'error'; entityType?: string | null; entityId?: string | null; at: string }
export interface ReviewQueueItem { id: string; kind: 'scraped_item' | 'hashtag' | 'knowledge_conflict'; entityId: string; title: string | null; reason: string; decisionRequested: string; options: string[]; resolved: boolean; resolvedBy: string | null; resolvedAt: string | null; outcome: string | null; createdAt: string | null }
export interface IntegrationStatus { configured: boolean; reason: string }
export interface Integrations { apify: IntegrationStatus; parallel: IntegrationStatus; gcp: IntegrationStatus; zImage: IntegrationStatus }
export interface ImageModelStatus extends ImageModelSpec { reachable: boolean; reason: string }

export interface StateSnapshot {
  keywords: Keyword[]; keywordSignals: KeywordSignal[]; hashtags: Hashtag[]; topHashtags: Hashtag[]; scraped: ScrapedItem[]; ideas: Idea[]; published: PublishedPost[]
  knowledge: KnowledgeEntry[]; knowledgeBuild: KnowledgeBuild | null; agents: AgentState[]; activity: ActivityEvent[]; analytics: PlatformMonth[]; reviewQueue: ReviewQueueItem[]
  integrations: Integrations; publishMode: 'demo' | 'live'; imageModels: ImageModelStatus[]; nextKnowledgeBuild: string
}

export interface HealthResponse { ok: boolean; database: string; publishMode: 'demo' | 'live'; registry: { agents: number; skills: number; stages: number; knobs: number }; integrations: Integrations; knowledgeCron: string; tz: string; nextKnowledgeBuild: string }
export type PipelineEventType =
  | 'pipeline.started' | 'pipeline.finished' | 'agent.started' | 'agent.finished' | 'agent.failed' | 'skill.started' | 'skill.finished' | 'skill.skipped' | 'skill.failed'
  | 'item.scraped' | 'item.validated' | 'hashtag.captured' | 'hashtag.validated' | 'keyword.ranked' | 'idea.created' | 'idea.ranked' | 'draft.generated' | 'post.published'
  | 'knowledge.written' | 'knowledge.build.started' | 'knowledge.build.finished' | 'activity'
export interface PipelineEvent { id: number; type: PipelineEventType; at: string; agentId?: AgentId; skillId?: string; runId?: string; message?: string; data?: Record<string, unknown> }

export interface TheaterItem { id: string; title: string; engagement: number; sourceName: string; sourceType: string; hashtags: string[]; relevance: number }
export interface TheaterVerdict { id: string; kind: 'item' | 'hashtag'; title: string; verdict: Validation; reason: string; credibility: Credibility; relevance: number; freshness: number; isDuplicate: boolean; keyword: string }
export interface PipelineResult {
  pipelineRunId: string; status: 'completed' | 'failed'; summary: Record<string, unknown>
  trendingKeywords: Array<{ keywordId: string; term: string; trendScore: number; rank: number; trendReason: string; postCount: number; components: { volume: number; engagement: number; velocity: number; growth: number } }>
  topHashtags: Array<{ tag: string; displayTag: string; keywordTerm: string; hashtagScore: number; globalRank: number }>
  ideas: Array<{ id: string; title: string; platform: Platform; calendarSlot: 'primary' | 'suggestion'; platformRank: number; date: string; time: string; confidence: number }>
  theater: { keywords: Array<{ id: string; term: string; items: TheaterItem[] }>; verdicts: TheaterVerdict[]; hashtagsByKeyword: Array<{ keyword: string; tags: Array<{ id: string; tag: string; rank: number; verdict: Validation; score: number }> }>; reviewQueue: Array<{ id: string; kind: string; entityId: string; title: string; reason: string; decisionRequested: string }> }
  error?: string
}
export interface RegistrySkill extends SkillSpec { enabled: boolean; values: Record<string, string | number | boolean>; isOverridden: boolean; stats: { runs: number; failures: number; avgMs: number } }
export interface DraftResponse { draft: Draft; media: MediaAsset | null; voice: { writer: string; source: 'live' | 'fixture'; model: string; fallbackReason: string | null; knowledgeEntries: number; grounded: boolean; changes: string[]; variants: string[] }; skills: Array<{ skillId: string; status: string; durationMs: number; note?: string }> }
export interface InstructResponse { draft: Draft; note: string; compliance: BrandCheck; preference: { title: string; content: string; category: string; tags: string[] } | null; preferenceSaved: boolean; diffSummary: string }
export interface Toast { id: number; kind: 'success' | 'info' | 'error'; title: string; body?: string }
export interface ChatMessage { id: number; role: 'user' | 'assistant'; text: string; at: string }
