// THE KEYWORD SET + hashtag vocabulary. Seeded into the `keywords` table, editable in Settings.
import { GENERIC_HASHTAGS } from './brand-voice'

export { GENERIC_HASHTAGS }

export type KeywordCategory = 'Core' | 'Adjacent' | 'Positioning'

export interface SeedKeyword {
  term: string
  category: KeywordCategory
  weight: number
}

export const SEED_KEYWORDS: SeedKeyword[] = [
  // Core research domains
  { term: 'reinforcement learning', category: 'Core', weight: 100 },
  { term: 'RLHF', category: 'Core', weight: 96 },
  { term: 'reward modeling', category: 'Core', weight: 92 },
  { term: 'agentic AI', category: 'Core', weight: 95 },
  { term: 'AI agents', category: 'Core', weight: 90 },
  { term: 'post-training', category: 'Core', weight: 88 },
  { term: 'model evaluation', category: 'Core', weight: 86 },
  { term: 'AI benchmarks', category: 'Core', weight: 84 },
  { term: 'AI environments', category: 'Core', weight: 82 },
  { term: 'synthetic data', category: 'Core', weight: 78 },
  // Adjacent / market
  { term: 'LLM fine-tuning', category: 'Adjacent', weight: 74 },
  { term: 'AI evaluation harness', category: 'Adjacent', weight: 72 },
  { term: 'multi-agent systems', category: 'Adjacent', weight: 70 },
  { term: 'AI infrastructure', category: 'Adjacent', weight: 66 },
  { term: 'inference optimization', category: 'Adjacent', weight: 64 },
  // Audience / positioning
  { term: 'AI research lab', category: 'Positioning', weight: 60 },
  { term: 'frontier models', category: 'Positioning', weight: 58 },
  { term: 'AI safety evaluation', category: 'Positioning', weight: 56 },
  { term: 'enterprise AI adoption', category: 'Positioning', weight: 52 },
  { term: 'engineering leadership AI', category: 'Positioning', weight: 48 },
]

/** Synonym expansions used by scraping.keyword.resolve when expandSynonyms is on. */
export const KEYWORD_SYNONYMS: Record<string, string[]> = {
  'reinforcement learning': ['RL', 'deep RL'],
  'RLHF': ['human feedback', 'preference optimization'],
  'reward modeling': ['reward model', 'reward hacking'],
  'agentic AI': ['agentic workflows', 'autonomous agents'],
  'AI agents': ['LLM agents', 'tool-using agents'],
  'post-training': ['post training', 'SFT'],
  'model evaluation': ['LLM evals', 'evals'],
  'AI benchmarks': ['benchmark saturation', 'eval benchmarks'],
  'AI environments': ['RL environments', 'agent sandboxes'],
  'synthetic data': ['data generation', 'self-play data'],
  'LLM fine-tuning': ['fine-tuning', 'LoRA'],
  'AI evaluation harness': ['eval harness', 'evaluation framework'],
  'multi-agent systems': ['multi-agent', 'agent orchestration'],
  'AI infrastructure': ['ML infra', 'GPU clusters'],
  'inference optimization': ['inference latency', 'serving'],
  'AI research lab': ['research lab', 'frontier lab'],
  'frontier models': ['frontier AI', 'foundation models'],
  'AI safety evaluation': ['safety evals', 'red teaming'],
  'enterprise AI adoption': ['enterprise AI', 'AI deployment'],
  'engineering leadership AI': ['engineering leadership', 'CTO AI'],
}

/** Canonical hashtag vocabulary per keyword. Used by fixtures and by relevance scoring. */
export const HASHTAG_VOCABULARY: Record<string, string[]> = {
  'reinforcement learning': ['ReinforcementLearning', 'RL', 'DeepRL', 'PolicyOptimization', 'RLResearch', 'GRPO', 'PPO'],
  'RLHF': ['RLHF', 'HumanFeedback', 'PreferenceLearning', 'DPO', 'Alignment', 'RLAIF'],
  'reward modeling': ['RewardModeling', 'RewardModel', 'RewardHacking', 'VerifiableRewards', 'RLVR', 'ProcessReward'],
  'agentic AI': ['AgenticAI', 'AgenticWorkflows', 'AutonomousAgents', 'AgentOps', 'ComputerUse'],
  'AI agents': ['AIAgents', 'LLMAgents', 'ToolUse', 'AgentFrameworks', 'MCP', 'AgentMemory'],
  'post-training': ['PostTraining', 'SFT', 'InstructionTuning', 'ModelDistillation', 'MidTraining'],
  'model evaluation': ['ModelEvaluation', 'LLMEvals', 'EvalDrivenDevelopment', 'LLMAsJudge', 'EvalHarness'],
  'AI benchmarks': ['AIBenchmarks', 'BenchmarkSaturation', 'SWEbench', 'GPQA', 'ARCAGI', 'HumanitysLastExam'],
  'AI environments': ['AIEnvironments', 'RLEnvironments', 'AgentSandbox', 'SimulationTraining', 'WorldModels'],
  'synthetic data': ['SyntheticData', 'DataGeneration', 'SelfPlay', 'DataFlywheel', 'RejectionSampling'],
  'LLM fine-tuning': ['FineTuning', 'LoRA', 'PEFT', 'LLMFineTuning', 'QLoRA'],
  'AI evaluation harness': ['EvalHarness', 'LLMTesting', 'EvaluationFramework', 'RegressionEvals'],
  'multi-agent systems': ['MultiAgentSystems', 'MultiAgent', 'AgentOrchestration', 'SwarmIntelligence'],
  'AI infrastructure': ['AIInfrastructure', 'MLInfra', 'GPUClusters', 'TrainingInfrastructure', 'MLOps'],
  'inference optimization': ['InferenceOptimization', 'LLMServing', 'SpeculativeDecoding', 'KVCache', 'Quantization'],
  'AI research lab': ['AIResearch', 'ResearchLab', 'FrontierLab', 'OpenResearch'],
  'frontier models': ['FrontierModels', 'FoundationModels', 'FrontierAI', 'ScalingLaws'],
  'AI safety evaluation': ['AISafety', 'SafetyEvals', 'RedTeaming', 'AIAlignment', 'DangerousCapabilities'],
  'enterprise AI adoption': ['EnterpriseAI', 'AIAdoption', 'AIDeployment', 'AITransformation'],
  'engineering leadership AI': ['EngineeringLeadership', 'CTO', 'AIStrategy', 'TechLeadership'],
}

/** Explicit semantic aliases. Key and value are normalised lower-case tags without '#'. */
export const HASHTAG_ALIASES: Record<string, string> = {
  rl: 'reinforcementlearning',
  deeprl: 'reinforcementlearning',
  genai: 'generativeai',
  llms: 'llm',
  largelanguagemodels: 'llm',
  llmagents: 'aiagents',
  agents: 'aiagents',
  agenticworkflows: 'agenticai',
  autonomousagents: 'agenticai',
  rewardmodel: 'rewardmodeling',
  evals: 'modelevaluation',
  llmevals: 'modelevaluation',
  evaluation: 'modelevaluation',
  benchmarks: 'aibenchmarks',
  finetuning: 'llmfinetuning',
  multiagent: 'multiagentsystems',
  mlinfra: 'aiinfrastructure',
  rlenvironments: 'aienvironments',
  safetyevals: 'aisafety',
  aialignment: 'alignment',
  posttraining: 'posttraining',
  sft: 'posttraining',
}

export function normaliseTag(tag: string): string {
  return tag.replace(/^#/, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export function resolveAlias(tag: string): string {
  const n = normaliseTag(tag)
  return HASHTAG_ALIASES[n] ?? n
}
