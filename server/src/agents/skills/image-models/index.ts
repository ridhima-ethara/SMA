import { IMAGE_MODELS } from '../../../../../shared/image-models'
import { brandSvg } from './brand-svg'
import { geminiFlashImage } from './gemini-flash-image'
import { imagen } from './imagen'
import type { ImageRenderer } from './types'
import { zImage } from './z-image'

export const RENDERERS: Record<string, ImageRenderer> = {
  [brandSvg.id]: brandSvg,
  [imagen.id]: imagen,
  [geminiFlashImage.id]: geminiFlashImage,
  [zImage.id]: zImage,
}

export function rendererStatus() {
  return IMAGE_MODELS.map((m) => {
    const r = RENDERERS[m.id]
    return { ...m, reachable: r ? r.isConfigured() : false, reason: r && !r.isConfigured() ? r.unavailableReason() : 'Ready' }
  })
}

export type { ImageRenderer }
