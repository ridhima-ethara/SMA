// Copies .env.example -> .env (root and server) when no .env exists yet.
import { existsSync, copyFileSync } from 'node:fs'
for (const dir of ['.', 'server']) {
  const example = `${dir}/.env.example`
  const target = `${dir}/.env`
  if (existsSync(example) && !existsSync(target)) {
    copyFileSync(example, target)
    console.log(`created ${target} from ${example}`)
  }
}
