import { IMAGE_MODELS } from '../../../../../shared/image-models'
import { brandSvg } from './brand-svg'
import { geminiFlashImage } from './gemini-flash-image'
import type { ImageRenderer } from './types'

/**
 * Every creative is painted by `gemini-flash-image` (GCP_IMAGE_MODEL, default
 * `gemini-2.5-flash-image`) and finished with the local brand layer. `brand-svg` is not an
 * alternative model — it is the always-available fallback used when the model call fails.
 *
 * The Imagen and Z-Image renderers were removed on purpose: Imagen's `:predict` publisher models
 * are not available to every project (they 404 while still reporting themselves configured), and
 * Z-Image needs a self-hosted endpoint. `z-image.ts` is retained but unregistered; re-add it here
 * and to shared/image-models.ts to bring it back.
 */
export const RENDERERS: Record<string, ImageRenderer> = {
  [brandSvg.id]: brandSvg,
  [geminiFlashImage.id]: geminiFlashImage,
}

export function rendererStatus() {
  return IMAGE_MODELS.map((m) => {
    const r = RENDERERS[m.id]
    return { ...m, reachable: r ? r.isConfigured() : false, reason: r && !r.isConfigured() ? r.unavailableReason() : 'Ready' }
  })
}

export type { ImageRenderer }
