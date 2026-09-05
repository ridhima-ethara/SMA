// Typed env accessor. Reads lazily at call time so adapters never bind to import-time state.
import 'dotenv/config'

const str = (k: string, d = ''): string => (process.env[k] ?? d).trim()
const int = (k: string, d: number): number => {
  const v = Number.parseInt(process.env[k] ?? '', 10)
  return Number.isFinite(v) ? v : d
}
const flt = (k: string, d: number): number => {
  const v = Number.parseFloat(process.env[k] ?? '')
  return Number.isFinite(v) ? v : d
}

export function env() {
  return {
    databaseUrl: str('DATABASE_URL', 'postgresql://ethara:ethara@localhost:5432/ethara_sma'),
    port: int('PORT', 4000),
    workspaceSlug: str('WORKSPACE_SLUG', 'ethara'),
    corsOrigin: str('CORS_ORIGIN', '*'),
    publishMode: (str('PUBLISH_MODE', 'demo') === 'live' ? 'live' : 'demo') as 'demo' | 'live',
    tz: str('TZ', 'Asia/Kolkata'),
    apify: {
      token: str('APIFY_API_TOKEN'),
      baseUrl: str('APIFY_BASE_URL', 'https://api.apify.com/v2'),
      postsActor: str('APIFY_LINKEDIN_POSTS_ACTOR', 'apimaestro~linkedin-posts-search-scraper-no-cookies'),
      hashtagActor: str('APIFY_LINKEDIN_HASHTAG_ACTOR', 'apimaestro~linkedin-hashtag-posts-scraper'),
      profileActor: str('APIFY_LINKEDIN_PROFILE_ACTOR', 'apimaestro~linkedin-profile-posts-scraper'),
      timeoutMs: int('APIFY_RUN_TIMEOUT_MS', 180000),
      maxItemsPerKeyword: int('APIFY_MAX_ITEMS_PER_KEYWORD', 50),
      memoryMbytes: int('APIFY_MEMORY_MBYTES', 1024),
    },
    parallel: {
      apiKey: str('PARALLEL_API_KEY'),
      baseUrl: str('PARALLEL_BASE_URL', 'https://api.parallel.ai'),
      searchPath: str('PARALLEL_SEARCH_PATH', '/v1beta/search'),
      taskPath: str('PARALLEL_TASK_PATH', '/v1/tasks/runs'),
      processor: str('PARALLEL_PROCESSOR', 'base'),
      maxResults: int('PARALLEL_MAX_RESULTS', 10),
      maxCharsPerResult: int('PARALLEL_MAX_CHARS_PER_RESULT', 6000),
      timeoutMs: int('PARALLEL_TIMEOUT_MS', 120000),
    },
    knowledge: {
      cron: str('KNOWLEDGE_BUILD_CRON', '0 6 * * 0'),
      hashtagCount: int('KNOWLEDGE_HASHTAG_COUNT', 25),
    },
    gcp: {
      apiKey: str('GCP_API_KEY'),
      projectId: str('GCP_PROJECT_ID'),
      location: str('GCP_LOCATION', 'us-central1'),
      serviceAccountJson: str('GCP_SERVICE_ACCOUNT_JSON'),
      textModel: str('GCP_TEXT_MODEL', 'gemini-2.5-pro'),
      fastTextModel: str('GCP_FAST_TEXT_MODEL', 'gemini-2.5-flash'),
      imageModel: str('GCP_IMAGE_MODEL', 'imagen-4.0-generate-001'),
      timeoutMs: int('GCP_TIMEOUT_MS', 90000),
      maxOutputTokens: int('GCP_MAX_OUTPUT_TOKENS', 2048),
      temperature: flt('GCP_TEMPERATURE', 0.6),
    },
    zImage: {
      endpoint: str('Z_IMAGE_ENDPOINT'),
      apiKey: str('Z_IMAGE_API_KEY'),
      modelId: str('Z_IMAGE_MODEL_ID', 'Tongyi-MAI/Z-Image-Turbo'),
      timeoutMs: int('Z_IMAGE_TIMEOUT_MS', 60000),
    },
  }
}

export type Env = ReturnType<typeof env>
