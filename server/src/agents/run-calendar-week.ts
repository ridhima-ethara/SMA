// Calendar Agent: plan one week of content from the Analysis Agent's top hashtags.
//
//   npm run agent:calendar-week
//   npm run agent:calendar-week -- --hashtags 5 --captions 1 --images 1
//   npm run agent:calendar-week -- --week-start 2026-09-14 --replace
//   npm run agent:calendar-week -- --show            print the stored plan, change nothing
//
// Reads a previously captured Analysis Agent output. No agent is re-run, and no caption
// or image is generated — only the schedule is written.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, query } from '../db/pool'
import { ensureWorkspace } from '../db/migrate'
import { getWeekSchedule, planWeekSchedule, type Platform, type ScheduleHashtag } from './week-schedule'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')

interface Flags {
  from: string
  out: string
  hashtags: number
  captions: number
  images: number
  days: number
  weekStart?: string
  platform: Platform
  weekStartsOn: 'monday' | 'sunday'
  replace: boolean
  show: boolean
  sourceDb: boolean
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = {
    from: 'out/assess-run.json',
    out: 'out/week-schedule.json',
    hashtags: 5,
    captions: 1,
    images: 1,
    days: 7,
    platform: 'linkedin',
    weekStartsOn: 'monday',
    replace: false,
    show: false,
    sourceDb: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--from') f.from = argv[++i] ?? f.from
    else if (a === '--out') f.out = argv[++i] ?? f.out
    else if (a === '--hashtags') f.hashtags = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--captions') f.captions = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--images') f.images = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--days') f.days = Number.parseInt(argv[++i] ?? '', 10)
    else if (a === '--week-start') f.weekStart = argv[++i]
    else if (a === '--platform') f.platform = (argv[++i] ?? 'linkedin') as Platform
    else if (a === '--week-starts-on') f.weekStartsOn = (argv[++i] ?? 'monday') as 'monday' | 'sunday'
    else if (a === '--replace') f.replace = true
    else if (a === '--show') f.show = true
    else if (a === '--source-db') f.sourceDb = true
  }
  return f
}

/** Top hashtags from a stored Analysis Agent output. Accepts either output shape. */
async function hashtagsFromFile(path: string): Promise<ScheduleHashtag[]> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    topHashtagsAcrossKeywords?: Array<{ tag: string; canonical?: string; keyword?: string; globalRank?: number; hashtagScore?: number }>
    produces?: { topHashtags?: Array<{ tag: string; displayTag: string; keywordTerm: string; globalRank: number; hashtagScore: number }> }
  }
  if (raw.topHashtagsAcrossKeywords?.length) {
    return raw.topHashtagsAcrossKeywords.map((h) => ({
      tag: (h.canonical ?? h.tag).toLowerCase(),
      displayTag: h.tag,
      keywordTerm: h.keyword ?? '',
      rank: h.globalRank ?? 0,
      score: h.hashtagScore ?? 0,
    }))
  }
  if (raw.produces?.topHashtags?.length) {
    return raw.produces.topHashtags.map((h) => ({
      tag: h.tag.toLowerCase(),
      displayTag: h.displayTag,
      keywordTerm: h.keywordTerm,
      rank: h.globalRank,
      score: h.hashtagScore,
    }))
  }
  throw new Error(`${path} has no topHashtagsAcrossKeywords or produces.topHashtags — is it an Analysis Agent output?`)
}

/** Fallback: the top set the last pipeline run persisted. */
async function hashtagsFromDb(workspaceId: string): Promise<ScheduleHashtag[]> {
  const rows = await query<{ tag: string; display_tag: string; term: string | null; rank: number | null; hashtag_score: number }>(
    `SELECT h.tag, h.display_tag, k.term, h.rank, h.hashtag_score FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id
      WHERE h.workspace_id = $1 AND h.in_top_set = true ORDER BY h.hashtag_score DESC, h.rank NULLS LAST`,
    [workspaceId],
  )
  return rows.map((r, i) => ({ tag: r.tag.toLowerCase(), displayTag: r.display_tag, keywordTerm: r.term ?? '', rank: r.rank ?? i + 1, score: r.hashtag_score }))
}

function print(schedule: Awaited<ReturnType<typeof planWeekSchedule>>): void {
  console.log(`\n[calendar] week ${schedule.weekStart} → ${schedule.weekEnd} (${schedule.timezone}) · status ${schedule.status}`)
  console.log(`[calendar] ${schedule.days} days · ${schedule.hashtagCount} hashtags · ${schedule.captionsPerDay} caption(s) + ${schedule.imagesPerDay} image(s) per day`)
  console.log(`[calendar] planned totals: ${schedule.plannedCaptions} captions · ${schedule.plannedImages} images — NOT generated\n`)
  console.log('  Day        Date         Time      Hashtag                     Rank  Captions  Images  Platform')
  console.log('  ' + '-'.repeat(96))
  for (const s of schedule.slots) {
    console.log(
      `  ${s.dayName.padEnd(10)} ${s.slotDate}   ${s.scheduledTime.padEnd(9)} #${s.displayHashtag.padEnd(26)} ${String(s.hashtagRank).padStart(4)}  ${String(s.captionsPlanned).padStart(8)}  ${String(s.imagesPlanned).padStart(6)}  ${s.platform}`,
    )
  }
  console.log('\n  Hashtag coverage:')
  for (const c of schedule.hashtagCoverage) {
    console.log(`    #${c.displayHashtag.padEnd(26)} rank ${String(c.rank).padStart(2)} → ${c.days.join(', ')}`)
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const outPath = isAbsolute(flags.out) ? flags.out : resolve(repoRoot, flags.out)
  const workspaceId = await ensureWorkspace()

  if (flags.show) {
    const existing = await getWeekSchedule(workspaceId, flags.weekStart)
    if (!existing) {
      console.log('[calendar] no schedule stored yet')
      return
    }
    print(existing)
    return
  }

  const fromPath = isAbsolute(flags.from) ? flags.from : resolve(repoRoot, flags.from)
  const all = flags.sourceDb ? await hashtagsFromDb(workspaceId) : await hashtagsFromFile(fromPath)
  console.log(`[calendar] ${all.length} hashtags available from ${flags.sourceDb ? 'hashtags.in_top_set' : flags.from}`)
  console.log(`[calendar] using the top ${flags.hashtags}: ${all.slice(0, flags.hashtags).map((h) => `#${h.displayTag}`).join(' ')}`)

  const schedule = await planWeekSchedule({
    workspaceId,
    hashtags: all,
    hashtagCount: flags.hashtags,
    captionsPerDay: flags.captions,
    imagesPerDay: flags.images,
    days: flags.days,
    weekStart: flags.weekStart,
    platform: flags.platform,
    weekStartsOn: flags.weekStartsOn,
    hashtagSource: flags.sourceDb ? 'database' : 'analysis',
    sourceRef: flags.sourceDb ? 'hashtags.in_top_set' : flags.from,
    replace: flags.replace,
  })
  print(schedule)

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8')
  console.log(`\n[calendar] wrote ${outPath}`)
  console.log('[calendar] captions and images are planned only — nothing was generated')
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`[calendar] failed · ${err instanceof Error ? err.message : String(err)}`)
    await closePool().catch(() => undefined)
    process.exit(1)
  })
