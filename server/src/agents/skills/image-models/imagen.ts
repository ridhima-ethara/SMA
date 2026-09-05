import { gcpImage } from '../../../integrations/gcp-llm'
import { ASPECT, type ImageRenderer } from './types'

export const imagen: ImageRenderer = {
  id: 'imagen-4',
  isConfigured: () => gcpImage.isConfigured(),
  unavailableReason: () => gcpImage.unavailableReason(),
  async paintBackground(prompt, platform) {
    const out = await gcpImage.run({ prompt, aspectRatio: ASPECT[platform] })
    return out.dataUri
  },
}
