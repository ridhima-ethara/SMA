// Seed corpus shared by the seed script and the agents: sources, competitors, brand topics, tables.
export { BRAND_TOPICS } from '../../../shared/brand-voice'

export interface SeedSource {
  name: string
  kind: 'linkedin' | 'instagram' | 'x' | 'web'
  sourceType: 'Social' | 'News' | 'Competitor' | 'Community' | 'Website'
  url: string
  trusted: boolean
}

export const SEED_SOURCES: SeedSource[] = [
  { name: 'LinkedIn', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com', trusted: true },
  { name: 'LinkedIn Hashtag Feeds', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/feed/hashtag', trusted: true },
  { name: 'arXiv cs.LG', kind: 'web', sourceType: 'News', url: 'https://arxiv.org/list/cs.LG/recent', trusted: true },
  { name: 'Hugging Face Blog', kind: 'web', sourceType: 'News', url: 'https://huggingface.co/blog', trusted: true },
  { name: 'ML Digest', kind: 'linkedin', sourceType: 'News', url: 'https://www.linkedin.com/company/ml-digest', trusted: true },
  { name: 'AI Weekly', kind: 'linkedin', sourceType: 'News', url: 'https://www.linkedin.com/company/ai-weekly', trusted: false },
  { name: 'r/MachineLearning', kind: 'web', sourceType: 'Community', url: 'https://www.reddit.com/r/MachineLearning', trusted: false },
  { name: 'Recruit Partners', kind: 'linkedin', sourceType: 'Community', url: 'https://www.linkedin.com/company/recruit-partners', trusted: false },
  { name: 'GrowthAI Labs', kind: 'linkedin', sourceType: 'Competitor', url: 'https://www.linkedin.com/company/growthai-labs', trusted: false },
  { name: 'Epoch AI', kind: 'web', sourceType: 'Website', url: 'https://epoch.ai', trusted: true },
  { name: 'X', kind: 'x', sourceType: 'Social', url: 'https://x.com', trusted: false },
]

export interface Competitor {
  name: string
  tier: 'P0' | 'P1'
  url: string
  focus: string
}

export const COMPETITORS: Competitor[] = [
  { name: 'Scale AI', tier: 'P0', url: 'https://www.linkedin.com/company/scaleai', focus: 'Data & evals' },
  { name: 'Surge AI', tier: 'P0', url: 'https://www.linkedin.com/company/surge-ai', focus: 'RLHF data' },
  { name: 'Anthropic', tier: 'P0', url: 'https://www.linkedin.com/company/anthropicresearch', focus: 'Frontier lab' },
  { name: 'OpenAI', tier: 'P0', url: 'https://www.linkedin.com/company/openai', focus: 'Frontier lab' },
  { name: 'Google DeepMind', tier: 'P0', url: 'https://www.linkedin.com/company/googledeepmind', focus: 'Frontier lab' },
  { name: 'Adaptive ML', tier: 'P0', url: 'https://www.linkedin.com/company/adaptive-ml', focus: 'RL post-training' },
  { name: 'Prime Intellect', tier: 'P1', url: 'https://www.linkedin.com/company/primeintellect', focus: 'Environments & RL' },
  { name: 'Mercor', tier: 'P1', url: 'https://www.linkedin.com/company/mercor', focus: 'Expert data' },
  { name: 'Turing', tier: 'P1', url: 'https://www.linkedin.com/company/turingcom', focus: 'Post-training data' },
  { name: 'Snorkel AI', tier: 'P1', url: 'https://www.linkedin.com/company/snorkel-ai', focus: 'Data programming' },
  { name: 'Labelbox', tier: 'P1', url: 'https://www.linkedin.com/company/labelbox', focus: 'Labeling' },
  { name: 'Weights & Biases', tier: 'P1', url: 'https://www.linkedin.com/company/wandb', focus: 'MLOps' },
  { name: 'Hugging Face', tier: 'P1', url: 'https://www.linkedin.com/company/huggingface', focus: 'Open models' },
  { name: 'Mistral AI', tier: 'P1', url: 'https://www.linkedin.com/company/mistralai', focus: 'Open frontier' },
  { name: 'Cohere', tier: 'P1', url: 'https://www.linkedin.com/company/cohere-ai', focus: 'Enterprise models' },
  { name: 'GrowthAI Labs', tier: 'P1', url: 'https://www.linkedin.com/company/growthai-labs', focus: 'RLHF tooling' },
]

export const FORMATS = ['Thought Leadership', 'Carousel', 'Short Post', 'Video', 'Case Study'] as const
export type Format = (typeof FORMATS)[number]

/** Format × platform fit (0–100). */
export const PLATFORM_FIT: Record<Format, Record<'linkedin' | 'instagram' | 'x', number>> = {
  'Thought Leadership': { linkedin: 94, instagram: 52, x: 74 },
  Carousel: { linkedin: 82, instagram: 93, x: 41 },
  'Short Post': { linkedin: 70, instagram: 61, x: 92 },
  Video: { linkedin: 76, instagram: 88, x: 69 },
  'Case Study': { linkedin: 90, instagram: 58, x: 63 },
}

/** Hour weights from this account's history (0–1). Index = hour of day. */
export const HOUR_WEIGHTS: number[] = [
  0.02, 0.01, 0.01, 0.01, 0.02, 0.04, 0.12, 0.35, 0.72, 0.88, 1.0, 0.94,
  0.78, 0.66, 0.71, 0.63, 0.55, 0.47, 0.32, 0.18, 0.1, 0.07, 0.04, 0.03,
]

export const DAY_WEIGHTS: Record<number, number> = { 0: 0.3, 1: 0.78, 2: 1.0, 3: 0.96, 4: 0.9, 5: 0.6, 6: 0.28 }

export interface CompetitorPost {
  competitor: string
  tier: 'P0' | 'P1'
  title: string
  format: Format
  engagementIndex: number
  ageHours: number
}
