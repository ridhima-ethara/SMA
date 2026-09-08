// Google Cloud adapter — Gemini text (API key or Vertex via service account) and Imagen backgrounds.
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from '../config'
import type { ServiceAdapter } from './apify'

/** Server package root, so a relative credential path does not depend on cwd. */
const serverRoot = resolve(fileURLToPath(import.meta.url), '../../..')

export interface GcpTextInput {
  system: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  fast?: boolean
}

export interface GcpTextOutput {
  text: string
  model: string
}

export interface GcpImageInput {
  prompt: string
  aspectRatio: '16:9' | '4:5' | '1:1'
  /** Overrides GCP_IMAGE_MODEL for a single call. */
  model?: string
}

export interface GcpImageOutput {
  dataUri: string
  model: string
}

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

let cachedToken: { value: string; expiresAt: number } | null = null

function loadServiceAccount(): ServiceAccount | null {
  const raw = env().gcp.serviceAccountJson
  if (!raw) return null
  try {
    // Either inline JSON or a path. Relative paths resolve against the server package
    // so `./secrets/gcp-sa.json` works whether the CLI runs from the repo root or server/.
    const text = raw.trim().startsWith('{') ? raw : readFileSync(isAbsolute(raw) ? raw : resolve(serverRoot, raw), 'utf8')
    return JSON.parse(text) as ServiceAccount
  } catch {
    return null
  }
}

/** Why the service account could not be loaded — for actionable error messages. */
export function serviceAccountProblem(): string {
  const raw = env().gcp.serviceAccountJson
  if (!raw) return 'GCP_SERVICE_ACCOUNT_JSON is not set'
  if (raw.trim().startsWith('{')) return loadServiceAccount() ? '' : 'GCP_SERVICE_ACCOUNT_JSON contains inline JSON that failed to parse'
  const path = isAbsolute(raw) ? raw : resolve(serverRoot, raw)
  try {
    readFileSync(path, 'utf8')
  } catch {
    return `service account file not readable at ${path}`
  }
  return loadServiceAccount() ? '' : `service account file at ${path} is not valid JSON`
}

export interface VertexAuth {
  projectId: string
  location: string
  token: string
  clientEmail: string
}

/** Vertex credentials for other adapters, or null when Vertex is not configured. */
export async function vertexAuth(): Promise<VertexAuth | null> {
  const g = env().gcp
  const sa = loadServiceAccount()
  if (!sa || !g.projectId) return null
  return { projectId: g.projectId, location: g.location, token: await accessToken(sa), clientEmail: sa.client_email }
}

export function isVertexConfigured(): boolean {
  return vertexMode()
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.value
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`GCP token exchange responded ${res.status}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

function vertexMode(): boolean {
  const g = env().gcp
  return Boolean(g.projectId && loadServiceAccount())
}

async function endpointFor(model: string, method: 'generateContent' | 'predict'): Promise<{ url: string; headers: Record<string, string> }> {
  const g = env().gcp
  if (vertexMode()) {
    const sa = loadServiceAccount() as ServiceAccount
    const token = await accessToken(sa)
    return {
      url: `https://${g.location}-aiplatform.googleapis.com/v1/projects/${g.projectId}/locations/${g.location}/publishers/google/models/${model}:${method}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    }
  }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${encodeURIComponent(g.apiKey)}`,
    headers: { 'content-type': 'application/json' },
  }
}

export const gcpText: ServiceAdapter<GcpTextInput, GcpTextOutput> = {
  id: 'gcp',
  label: 'Google Cloud · Gemini',
  isConfigured: () => env().gcp.apiKey.length > 0 || vertexMode(),
  unavailableReason: () => (env().gcp.apiKey || vertexMode() ? '' : 'GCP_API_KEY is not set — captions come from the built-in template writer until Gemini is configured'),
  async run(input) {
    if (!this.isConfigured()) throw new Error(this.unavailableReason())
    const g = env().gcp
    const model = input.fast ? g.fastTextModel : g.textModel
    const { url, headers } = await endpointFor(model, 'generateContent')
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: { temperature: input.temperature ?? g.temperature, maxOutputTokens: input.maxOutputTokens ?? g.maxOutputTokens },
      }),
      signal: AbortSignal.timeout(g.timeoutMs),
    })
    if (!res.ok) throw new Error(`Gemini ${model} responded ${res.status}`)
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) throw new Error('Gemini returned an empty candidate')
    return { text, model }
  },
}

/** Imagen speaks `:predict`; Gemini image models speak `:generateContent`. */
const usesPredict = (model: string): boolean => /^(imagen|imagegeneration)/i.test(model)

export const gcpImage: ServiceAdapter<GcpImageInput, GcpImageOutput> = {
  id: 'gcp-image',
  label: 'Google Cloud · Gemini Image',
  isConfigured: () => gcpText.isConfigured(),
  unavailableReason: () => (gcpText.isConfigured() ? '' : 'Neither GCP_API_KEY nor GCP_SERVICE_ACCOUNT_JSON is set — creatives use the local brand renderer until Gemini is configured'),
  async run(input) {
    if (!this.isConfigured()) throw new Error(this.unavailableReason())
    const g = env().gcp
    const model = input.model || g.imageModel
    // The endpoint is chosen from the model family, not hardcoded. Pointing GCP_IMAGE_MODEL at a
    // Gemini image model while forcing `:predict` is what returned 400 on every render.
    const predict = usesPredict(model)
    const { url, headers } = await endpointFor(model, predict ? 'predict' : 'generateContent')
    const body = predict
      ? { instances: [{ prompt: input.prompt }], parameters: { sampleCount: 1, aspectRatio: input.aspectRatio } }
      : { contents: [{ role: 'user', parts: [{ text: input.prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(g.timeoutMs) })
    if (!res.ok) {
      let detail = ''
      try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '' } catch { /* non-JSON body */ }
      throw new Error(`${model} responded ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ''}`)
    }
    if (predict) {
      const json = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }> }
      const p = json.predictions?.[0]
      if (!p?.bytesBase64Encoded) throw new Error(`${model} returned no image bytes`)
      return { dataUri: `data:${p.mimeType ?? 'image/png'};base64,${p.bytesBase64Encoded}`, model }
    }
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }> }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    if (!part?.inlineData) throw new Error(`${model} returned no inline image`)
    return { dataUri: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, model }
  },
}

export function integrationStatus() {
  const tag = (a: ServiceAdapter<unknown, unknown>) => ({ configured: a.isConfigured(), reason: a.isConfigured() ? 'Configured' : a.unavailableReason() })
  return { gcp: tag(gcpText as ServiceAdapter<unknown, unknown>), gcpImage: tag(gcpImage as ServiceAdapter<unknown, unknown>) }
}
