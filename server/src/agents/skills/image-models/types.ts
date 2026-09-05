import type { Platform } from '../../../../../shared/brand-voice'

/** A background painter. It is never asked to draw text; the brand layer is composited on top locally. */
export interface ImageRenderer {
  id: string
  isConfigured(): boolean
  unavailableReason(): string
  paintBackground(prompt: string, platform: Platform): Promise<string>
}

export const ASPECT: Record<Platform, '16:9' | '4:5' | '1:1'> = { linkedin: '16:9', instagram: '4:5', x: '16:9' }
