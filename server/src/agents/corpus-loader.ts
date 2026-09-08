// Reads the corpus folder off disk and turns each document into page-aware,
// overlapping text chunks. Nothing here talks to the database or the embedder.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, type EmbeddingConfig } from '../config'

const require_ = createRequire(import.meta.url)
const serverRoot = resolve(fileURLToPath(import.meta.url), '../../..')
/** pdfjs needs the bundled font metrics to decode text from non-embedded fonts. */
const STANDARD_FONTS = join(resolve(require_.resolve('pdfjs-dist/package.json'), '..'), 'standard_fonts') + sep

export const SUPPORTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.markdown'] as const

export interface CorpusFile {
  absolutePath: string
  /** Path relative to the corpus root — the stable identity of a document. */
  sourcePath: string
  filename: string
  title: string
  mediaType: string
  bytes: number
}

export interface DocumentPage {
  page: number
  text: string
}

export interface LoadedDocument {
  file: CorpusFile
  pages: DocumentPage[]
  text: string
  charCount: number
  sha256: string
}

export interface Chunk {
  index: number
  content: string
  charCount: number
  tokenEstimate: number
  pageStart: number
  pageEnd: number
}

/** Absolute path of the configured corpus folder, resolved against the server package. */
export function corpusRoot(cfg: EmbeddingConfig = env().embeddings): string {
  return resolve(serverRoot, cfg.corpusDir)
}

const MEDIA_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
}

/** Filenames carry the real titles here, so clean them up rather than guessing from content. */
export function titleFromFilename(filename: string): string {
  return basename(filename, extname(filename))
    .replace(/[_-]?compressed$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Recursively lists supported documents under the corpus root, sorted for stable runs. */
export async function listCorpusFiles(root = corpusRoot()): Promise<CorpusFile[]> {
  const found: CorpusFile[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const ext = extname(entry.name).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) continue
      const info = await stat(full)
      found.push({
        absolutePath: full,
        sourcePath: relative(root, full),
        filename: entry.name,
        title: titleFromFilename(entry.name),
        mediaType: MEDIA_TYPES[ext] ?? 'application/octet-stream',
        bytes: info.size,
      })
    }
  }
  try {
    await walk(root)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') throw new Error(`Corpus folder not found at ${root} — set CORPUS_DIR in server/.env`)
    throw err
  }
  return found.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath))
}

/**
 * Tidies extracted PDF text: rejoins words split across line breaks, drops the
 * single newlines that come from line wrapping while keeping blank lines as
 * paragraph boundaries.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // Some PDFs decode to NUL and other C0 control characters. Postgres TEXT
    // rejects 0x00 outright, so stripping controls here is deliberate.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    // Lone surrogates survive some CMap decodes and are invalid UTF-8.
    .replace(/[\ud800-\udfff]/g, '')
    .replace(/\ufffe|\uffff/g, '')
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/([A-Za-z])-\n([a-z])/g, '$1$2') // hyphenated line break
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n\n')
    .map((para) => para.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

async function extractPdfPages(absolutePath: string): Promise<DocumentPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(absolutePath))
  const loadingTask = pdfjs.getDocument({
    data,
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
    disableFontFace: true,
    // Text extraction only; skip the work of decoding embedded images.
    stopAtErrors: false,
  })
  try {
    const doc = await loadingTask.promise
    const pages: DocumentPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      try {
        const content = await page.getTextContent()
        const raw = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join('')
        pages.push({ page: n, text: normalizeText(raw) })
      } finally {
        page.cleanup()
      }
    }
    return pages
  } finally {
    // PDFDocumentProxy has no destroy() in pdfjs 6 — the loading task owns teardown.
    await loadingTask.destroy().catch(() => undefined)
  }
}

/** Reads one document into normalized pages plus a content hash for change detection. */
export async function loadDocument(file: CorpusFile): Promise<LoadedDocument> {
  const bytes = await readFile(file.absolutePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const pages =
    file.mediaType === 'application/pdf'
      ? await extractPdfPages(file.absolutePath)
      : [{ page: 1, text: normalizeText(bytes.toString('utf8')) }]
  const text = pages.map((p) => p.text).join('\n\n')
  // Count only real page content, not the separators — a scanned PDF must report 0
  // so callers can tell "no extractable text" apart from "very little text".
  const charCount = pages.reduce((total, p) => total + p.text.length, 0)
  return { file, pages, text, charCount, sha256 }
}

/** Rough token count. Good enough for reporting; no tokenizer dependency. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** Finds a natural break near the end of a window: paragraph > sentence > word. */
function snapEnd(text: string, from: number, to: number): number {
  const floor = from + Math.floor((to - from) * 0.6)
  const window = text.slice(floor, to)
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph > 0) return floor + paragraph + 2
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
  if (sentence > 0) return floor + sentence + 2
  const space = window.lastIndexOf(' ')
  if (space > 0) return floor + space + 1
  return to
}

/**
 * Slices a document into overlapping chunks of at most `chunkChars`, snapping to
 * paragraph or sentence boundaries and carrying `chunkOverlap` characters of context
 * across each cut so a fact split across a boundary stays retrievable.
 */
export function chunkDocument(doc: LoadedDocument, cfg: EmbeddingConfig = env().embeddings): Chunk[] {
  // Absolute [start,end) offset of every page inside the joined text.
  const separator = '\n\n'
  const spans: Array<{ page: number; start: number; end: number }> = []
  let offset = 0
  for (const [i, page] of doc.pages.entries()) {
    spans.push({ page: page.page, start: offset, end: offset + page.text.length })
    offset += page.text.length + (i < doc.pages.length - 1 ? separator.length : 0)
  }
  const pageAt = (position: number): number => {
    for (const span of spans) if (position >= span.start && position < span.end) return span.page
    // Position landed inside a separator or past the end: use the nearest page.
    let nearest = spans[0]?.page ?? 1
    for (const span of spans) if (span.start <= position) nearest = span.page
    return nearest
  }

  const text = doc.text
  const chunks: Chunk[] = []
  let cursor = 0
  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + cfg.chunkChars, text.length)
    const end = hardEnd >= text.length ? text.length : snapEnd(text, cursor, hardEnd)
    const slice = text.slice(cursor, end)
    const content = slice.trim()
    if (content.length >= cfg.minChunkChars) {
      const leading = slice.length - slice.trimStart().length
      const contentStart = cursor + leading
      chunks.push({
        index: chunks.length,
        content,
        charCount: content.length,
        tokenEstimate: estimateTokens(content),
        pageStart: pageAt(contentStart),
        pageEnd: pageAt(Math.max(contentStart + content.length - 1, contentStart)),
      })
    }
    if (end >= text.length) break
    // Step forward by at least one character so the loop always terminates.
    cursor = Math.max(end - cfg.chunkOverlap, cursor + 1)
  }
  return chunks
}
