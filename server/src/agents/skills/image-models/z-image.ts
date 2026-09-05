import { env } from '../../../config'
import type { ImageRenderer } from './types'

export const zImage: ImageRenderer = {
  id: 'z-image-turbo',
  isConfigured: () => env().zImage.endpoint.length > 0 && env().zImage.apiKey.length > 0,
  unavailableReason: () => (env().zImage.endpoint && env().zImage.apiKey ? '' : 'Z_IMAGE_ENDPOINT / Z_IMAGE_API_KEY are not set — the Z-Image renderer is unavailable'),
  async paintBackground(prompt) {
    const z = env().zImage
    const res = await fetch(z.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${z.apiKey}` },
      body: JSON.stringify({ model: z.modelId, prompt, n: 1, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(z.timeoutMs),
    })
    if (!res.ok) throw new Error(`Z-Image responded ${res.status}`)
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new Error('Z-Image returned no image data')
    return `data:image/png;base64,${b64}`
  },
}
