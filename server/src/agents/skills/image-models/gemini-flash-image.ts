import { env } from '../../../config'
import { gcpText } from '../../../integrations/gcp-llm'
import type { ImageRenderer } from './types'

/** Gemini image generation over the generativelanguage endpoint (API-key mode). */
export const geminiFlashImage: ImageRenderer = {
  id: 'gemini-flash-image',
  isConfigured: () => env().gcp.apiKey.length > 0,
  unavailableReason: () => (env().gcp.apiKey ? '' : gcpText.unavailableReason()),
  async paintBackground(prompt) {
    const g = env().gcp
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(g.apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
      signal: AbortSignal.timeout(g.timeoutMs),
    })
    if (!res.ok) throw new Error(`Gemini image responded ${res.status}`)
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }> }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    if (!part?.inlineData) throw new Error('Gemini image returned no inline image')
    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
  },
}
