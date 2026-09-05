// Regenerates the public logo assets from the single traced source in shared/logo-mark.ts.
import { writeFileSync } from 'node:fs'
import { logoMarkSvg } from '../shared/logo-mark'

writeFileSync('public/logo.svg', logoMarkSvg(256))
writeFileSync('public/favicon.svg', logoMarkSvg(64))
console.log('[logo] public/logo.svg + public/favicon.svg regenerated')
