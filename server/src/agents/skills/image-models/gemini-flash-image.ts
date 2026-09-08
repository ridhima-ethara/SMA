import { env } from '../../../config'
import { gcpImage } from '../../../integrations/gcp-llm'
import { ASPECT, type ImageRenderer } from './types'

/**
 * The only generative image renderer. The model comes from GCP_IMAGE_MODEL, which defaults to
 * `gemini-2.5-flash-image`; `gcpImage` picks the right endpoint for whatever is configured
 * (`:generateContent` for Gemini image models, `:predict` for Imagen), and works under both a
 * Vertex service account and a plain API key.
 */
export const geminiFlashImage: ImageRenderer = {
  id: 'gemini-flash-image',
  isConfigured: () => gcpImage.isConfigured(),
  unavailableReason: () => gcpImage.unavailableReason(),
  async paintBackground(prompt, platform) {
    const out = await gcpImage.run({ prompt, aspectRatio: ASPECT[platform], model: env().gcp.imageModel })
    return out.dataUri
  },
}
