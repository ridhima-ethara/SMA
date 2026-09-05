import type { ImageRenderer } from './types'

/** The local renderer paints no background — the vector field inside composeBrandSvg is the field. */
export const brandSvg: ImageRenderer = {
  id: 'brand-svg',
  isConfigured: () => true,
  unavailableReason: () => '',
  async paintBackground() {
    return ''
  },
}
