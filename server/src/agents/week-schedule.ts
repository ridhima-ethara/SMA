// Calendar Agent: builds a one-week posting schedule from the Analysis Agent's top
// hashtags. One hashtag per day, with a configurable number of captions and images
// planned against each day.
//
// This plans only. No caption or image is generated here — the slots carry the intended
// counts and the hashtag to build from, and generation runs later against them.
import { env } from '../config'
import { one, query, withTransaction } from '../db/pool'
import { DAY_WEIGHTS, HOUR_WEIGHTS } from './corpus'

export interface ScheduleHashtag {
  /** Normalised tag, e.g. 'agenticai'. */
  tag: string
  /** Display casing, e.g. 'AgenticAI'. */
  displayTag: string
  keywordTerm: string
  /** Global rank from the Analysis Agent, 1 = strongest. */
  rank: number
  score: number
}

export type Platform = 'linkedin' | 'instagram' | 'x'

export interface WeekScheduleOptions {
  workspaceId: string
  hashtags: ScheduleHashtag[]
  /** Monday of the target week by default; any date resolves to its week. */
  weekStart?: string
  days?: number
  /** How many of the supplied hashtags to use. */
  hashtagCount?: number
  captionsPerDay?: number
  imagesPerDay?: number
  platform?: Platform
  weekStartsOn?: 'monday' | 'sunday'
  windowStart?: number
  windowEnd?: number
  /** Where the hashtags came from, recorded for traceability. */
  sourceRef?: string
  hashtagSource?: 'analysis' | 'database'
  /** Replace an existing plan for the same week. */
  replace?: boolean
}

export interface ScheduleSlot {
  slotDate: string
  dayOfWeek: number
  dayName: string
  position: number
  hashtagId: string | null
  hashtag: string
  displayHashtag: string
  keywordTerm: string
  hashtagRank: number
  hashtagScore: number
  platform: Platform
  scheduledTime: string
  captionsPlanned: number
  imagesPlanned: number
  /** Progress against the plan. Zero until generation runs. */
  captionsGenerated: number
  imagesGenerated: number
  /** The content_ideas row holding this day's generated caption, media and review history. */
  ideaId: string | null
  status: string
  rationale: string
}

export interface WeekSchedule {
  id: string
  weekStart: string
  weekEnd: string
  timezone: string
  days: number
  hashtagCount: number
  captionsPerDay: number
  imagesPerDay: number
  plannedCaptions: number
  plannedImages: number
  hashtagSource: string
  hashtagSourceRef: string | null
  status: string
  slots: ScheduleSlot[]
  /** Which hashtag covers which days, for a quick read of the rotation. */
  hashtagCoverage: Array<{ displayHashtag: string; rank: number; days: string[] }>
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Start of the week containing `from`, respecting the configured first day. */
export function weekStartFor(from: Date, startsOn: 'monday' | 'sunday' = 'monday'): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const dow = d.getDay()
  const offset = startsOn === 'monday' ? (dow === 0 ? -6 : 1 - dow) : -dow
  d.setDate(d.getDate() + offset)
  return d
}

/** Highest-weight posting hour inside the window, from this account's hour history. */
function bestHour(windowStart: number, windowEnd: number, skip = 0): number {
  const hours = Array.from({ length: 24 }, (_, h) => h)
    .filter((h) => h >= windowStart && h <= windowEnd)
    .sort((a, b) => (HOUR_WEIGHTS[b] ?? 0) - (HOUR_WEIGHTS[a] ?? 0) || a - b)
  if (!hours.length) return windowStart
  return hours[skip % hours.length]
}

const formatTime = (hour: number, minute = 30): string => {
  const period = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`
}

/**
 * Assigns hashtags to days. The strongest hashtag lands on the strongest day by this
 * account's day-of-week engagement history, and when there are fewer hashtags than days
 * the rotation cycles so every day is covered.
 */
function assignHashtags(dates: Date[], hashtags: ScheduleHashtag[]): Map<string, ScheduleHashtag> {
  const ranked = [...hashtags].sort((a, b) => a.rank - b.rank)
  // Days ordered by historical engagement weight, strongest first.
  const byStrength = [...dates].sort((a, b) => (DAY_WEIGHTS[b.getDay()] ?? 0) - (DAY_WEIGHTS[a.getDay()] ?? 0) || a.getTime() - b.getTime())
  const assignment = new Map<string, ScheduleHashtag>()
  byStrength.forEach((date, i) => {
    // Cycle when days outnumber hashtags, so a 5-hashtag set still fills 7 days.
    assignment.set(iso(date), ranked[i % ranked.length])
  })
  return assignment
}

/**
 * Builds and stores the week's plan. Existing plans for the same week are only replaced
 * when `replace` is set, so a re-run cannot silently discard a plan already in progress.
 */
export async function planWeekSchedule(options: WeekScheduleOptions): Promise<WeekSchedule> {
  const cfg = env()
  const startsOn = options.weekStartsOn ?? 'monday'
  const days = Math.max(1, Math.min(31, options.days ?? 7))
  const hashtagCount = Math.max(1, options.hashtagCount ?? 5)
  const captionsPerDay = Math.max(0, options.captionsPerDay ?? 1)
  const imagesPerDay = Math.max(0, options.imagesPerDay ?? 1)
  const platform: Platform = options.platform ?? 'linkedin'
  const windowStart = options.windowStart ?? 8
  const windowEnd = options.windowEnd ?? 18

  const hashtags = [...options.hashtags].sort((a, b) => a.rank - b.rank).slice(0, hashtagCount)
  if (!hashtags.length) throw new Error('no hashtags supplied — run the Analysis Agent first, or pass its output')

  const start = weekStartFor(options.weekStart ? new Date(`${options.weekStart}T00:00:00`) : new Date(), startsOn)
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    return d
  })
  const weekStart = iso(dates[0])
  const weekEnd = iso(dates[dates.length - 1])

  const existing = await one<{ id: string; status: string }>('SELECT id, status FROM content_schedules WHERE workspace_id = $1 AND week_start = $2', [options.workspaceId, weekStart])
  if (existing && !options.replace) {
    throw new Error(`a schedule for the week of ${weekStart} already exists (status '${existing.status}') — pass replace to rebuild it`)
  }

  // Resolve hashtag rows so slots can link to them where the tag is already known.
  const tags = hashtags.map((h) => h.tag.toLowerCase())
  const rows = tags.length
    ? await query<{ id: string; tag: string; hashtag_score: number }>(
        `SELECT DISTINCT ON (tag) id, tag, hashtag_score FROM hashtags
          WHERE workspace_id = $1 AND lower(tag) = ANY($2::text[]) ORDER BY tag, hashtag_score DESC`,
        [options.workspaceId, tags],
      )
    : []
  const idByTag = new Map(rows.map((r) => [r.tag.toLowerCase(), r.id]))

  const assignment = assignHashtags(dates, hashtags)
  const slots: ScheduleSlot[] = dates.map((date, i) => {
    const h = assignment.get(iso(date)) as ScheduleHashtag
    const dow = date.getDay()
    const hour = bestHour(windowStart, windowEnd, i)
    const dayWeight = Math.round((DAY_WEIGHTS[dow] ?? 0) * 100)
    return {
      slotDate: iso(date),
      dayOfWeek: dow,
      dayName: DAY_NAMES[dow],
      position: i + 1,
      hashtagId: idByTag.get(h.tag.toLowerCase()) ?? null,
      hashtag: h.tag,
      displayHashtag: h.displayTag,
      keywordTerm: h.keywordTerm,
      hashtagRank: h.rank,
      hashtagScore: h.score,
      platform,
      scheduledTime: formatTime(hour),
      captionsPlanned: captionsPerDay,
      imagesPlanned: imagesPerDay,
      captionsGenerated: 0,
      imagesGenerated: 0,
      ideaId: null,
      status: 'planned',
      rationale:
        `#${h.displayTag} is analysis rank ${h.rank} (score ${h.score})${h.keywordTerm ? ` from keyword "${h.keywordTerm}"` : ''}. ` +
        `${DAY_NAMES[dow]} carries ${dayWeight}% of this account's peak day weight, and ${formatTime(hour)} is the strongest hour in the ${windowStart}:00–${windowEnd}:00 window. ` +
        `Planned: ${captionsPerDay} caption(s) and ${imagesPerDay} image(s).`,
    }
  })

  const plannedCaptions = slots.reduce((n, s) => n + s.captionsPlanned, 0)
  const plannedImages = slots.reduce((n, s) => n + s.imagesPlanned, 0)

  const scheduleId = await withTransaction(async (client) => {
    if (existing) await client.query('DELETE FROM content_schedules WHERE id = $1', [existing.id])
    const res = await client.query<{ id: string }>(
      `INSERT INTO content_schedules
         (workspace_id, week_start, week_end, timezone, days, hashtag_count, captions_per_day, images_per_day,
          planned_captions, planned_images, hashtag_source, hashtag_source_ref, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'planned',$13) RETURNING id`,
      [
        options.workspaceId,
        weekStart,
        weekEnd,
        cfg.tz,
        days,
        hashtags.length,
        captionsPerDay,
        imagesPerDay,
        plannedCaptions,
        plannedImages,
        options.hashtagSource ?? 'analysis',
        options.sourceRef ?? null,
        `One hashtag per day across ${days} days from the top ${hashtags.length} analysis hashtags. Captions and images are planned, not generated.`,
      ],
    )
    const id = res.rows[0].id
    for (const s of slots) {
      await client.query(
        `INSERT INTO content_schedule_slots
           (workspace_id, schedule_id, slot_date, day_of_week, day_name, position, hashtag_id, hashtag, display_hashtag,
            keyword_term, hashtag_rank, hashtag_score, platform, scheduled_time, captions_planned, images_planned, status, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'planned',$17)`,
        [
          options.workspaceId, id, s.slotDate, s.dayOfWeek, s.dayName, s.position, s.hashtagId, s.hashtag, s.displayHashtag,
          s.keywordTerm || null, s.hashtagRank, s.hashtagScore, s.platform, s.scheduledTime, s.captionsPlanned, s.imagesPlanned, s.rationale,
        ],
      )
    }
    return id
  })

  const coverage = hashtags.map((h) => ({
    displayHashtag: h.displayTag,
    rank: h.rank,
    days: slots.filter((s) => s.hashtag === h.tag).map((s) => `${s.dayName} ${s.slotDate}`),
  }))

  return {
    id: scheduleId,
    weekStart,
    weekEnd,
    timezone: cfg.tz,
    days,
    hashtagCount: hashtags.length,
    captionsPerDay,
    imagesPerDay,
    plannedCaptions,
    plannedImages,
    hashtagSource: options.hashtagSource ?? 'analysis',
    hashtagSourceRef: options.sourceRef ?? null,
    status: 'planned',
    slots,
    hashtagCoverage: coverage,
  }
}

/** Reads back a stored schedule with its slots. */
export async function getWeekSchedule(workspaceId: string, weekStart?: string): Promise<WeekSchedule | null> {
  const head = weekStart
    ? await one<Record<string, unknown>>('SELECT * FROM content_schedules WHERE workspace_id = $1 AND week_start = $2', [workspaceId, weekStart])
    : await one<Record<string, unknown>>('SELECT * FROM content_schedules WHERE workspace_id = $1 ORDER BY week_start DESC LIMIT 1', [workspaceId])
  if (!head) return null
  const slotRows = await query<Record<string, unknown>>(
    'SELECT * FROM content_schedule_slots WHERE schedule_id = $1 ORDER BY position',
    [head.id as string],
  )
  const day = (v: unknown): string => (v instanceof Date ? iso(v) : String(v).slice(0, 10))
  const slots: ScheduleSlot[] = slotRows.map((r) => ({
    slotDate: day(r.slot_date),
    dayOfWeek: Number(r.day_of_week),
    dayName: String(r.day_name),
    position: Number(r.position),
    hashtagId: (r.hashtag_id as string) ?? null,
    hashtag: String(r.hashtag),
    displayHashtag: String(r.display_hashtag),
    keywordTerm: (r.keyword_term as string) ?? '',
    hashtagRank: Number(r.hashtag_rank ?? 0),
    hashtagScore: Number(r.hashtag_score ?? 0),
    platform: String(r.platform) as Platform,
    scheduledTime: String(r.scheduled_time),
    captionsPlanned: Number(r.captions_planned),
    imagesPlanned: Number(r.images_planned),
    captionsGenerated: Number(r.captions_generated ?? 0),
    imagesGenerated: Number(r.images_generated ?? 0),
    ideaId: (r.idea_id as string) ?? null,
    status: String(r.status),
    rationale: String(r.rationale ?? ''),
  }))
  const byTag = new Map<string, { displayHashtag: string; rank: number; days: string[] }>()
  for (const s of slots) {
    const cur = byTag.get(s.hashtag) ?? { displayHashtag: s.displayHashtag, rank: s.hashtagRank, days: [] }
    cur.days.push(`${s.dayName} ${s.slotDate}`)
    byTag.set(s.hashtag, cur)
  }
  return {
    id: String(head.id),
    weekStart: day(head.week_start),
    weekEnd: day(head.week_end),
    timezone: String(head.timezone),
    days: Number(head.days),
    hashtagCount: Number(head.hashtag_count),
    captionsPerDay: Number(head.captions_per_day),
    imagesPerDay: Number(head.images_per_day),
    plannedCaptions: Number(head.planned_captions),
    plannedImages: Number(head.planned_images),
    hashtagSource: String(head.hashtag_source),
    hashtagSourceRef: (head.hashtag_source_ref as string) ?? null,
    status: String(head.status),
    slots,
    hashtagCoverage: Array.from(byTag.values()).sort((a, b) => a.rank - b.rank),
  }
}

/**
 * Hashtags for a schedule, sourced from the database so the API and UI can plan without
 * a file. Prefers the Analysis Agent's persisted top set, then fills from the
 * highest-scoring hashtags so a plan is still possible before a pipeline run has
 * marked a top set.
 */
export async function topHashtagsFromDb(workspaceId: string, limit: number): Promise<{ hashtags: ScheduleHashtag[]; usedFallback: boolean }> {
  const rows = await query<{ tag: string; display_tag: string; term: string | null; rank: number | null; hashtag_score: number; in_top_set: boolean }>(
    `SELECT DISTINCT ON (h.tag) h.tag, h.display_tag, k.term, h.rank, h.hashtag_score, h.in_top_set
       FROM hashtags h LEFT JOIN keywords k ON k.id = h.keyword_id
      WHERE h.workspace_id = $1 AND h.validation <> 'rejected'
      ORDER BY h.tag, h.in_top_set DESC, h.rank ASC NULLS LAST, h.hashtag_score DESC`,
    [workspaceId],
  )
  // Published top-set members first, in the Analysis Agent's own rank order. Score only
  // breaks ties or orders the fallback tail.
  const ordered = rows.sort(
    (a, b) =>
      Number(b.in_top_set) - Number(a.in_top_set) ||
      (a.in_top_set && b.in_top_set ? (a.rank ?? 999) - (b.rank ?? 999) : 0) ||
      b.hashtag_score - a.hashtag_score,
  )
  const picked = ordered.slice(0, Math.max(1, limit))
  return {
    hashtags: picked.map((r, i) => ({
      tag: r.tag.toLowerCase(),
      displayTag: r.display_tag,
      keywordTerm: r.term ?? '',
      rank: i + 1,
      score: r.hashtag_score,
    })),
    usedFallback: picked.some((r) => !r.in_top_set),
  }
}
