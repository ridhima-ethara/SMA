// Calendar & Ideas Agent skills — stage `plan`.
import { similarity } from '../../../../shared/brand-voice'
import { DAY_WEIGHTS, HOUR_WEIGHTS, PLATFORM_FIT, type Format } from '../corpus'
import { registerSkill } from '../runtime'
import type { Cluster } from './assess'

export type Platform = 'linkedin' | 'instagram' | 'x'
const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x']

export interface IdeaAnalysis {
  brandRelevance: number
  trendScore: number
  engagementLevel: 'High' | 'Medium' | 'Low'
  engagementScore: number
  format: Format
  bestDay: string
  angle: string
  audience: string
  hashtag?: string
  keyword: string
  slotReasons: string[]
  platformScores: Record<Platform, number>
  explanation: string
  competitorNote: string
  adaptNotes?: Partial<Record<Platform, string>>
  conflicts?: string[]
}

export interface IdeaDraft {
  key: string
  title: string
  description: string
  sourceTopic: string
  sourceKey: string
  hashtagTag?: string
  hashtagDisplay?: string
  platform: Platform
  altPlatforms: Array<{ platform: Platform; score: number }>
  date: string
  time: string
  hour: number
  confidence: number
  priorityScore: number
  platformRank: number
  calendarSlot: 'primary' | 'suggestion'
  analysis: IdeaAnalysis
  isNewTrend: boolean
}

export interface ExistingIdea {
  id?: string
  title: string
  date: string
  platform: Platform
  hour?: number
  confidence?: number
  priorityScore?: number
  calendarSlot?: 'primary' | 'suggestion'
  status?: string
}

export interface PlanPayload extends Record<string, unknown> {
  opportunities: Cluster[]
  existingIdeas: ExistingIdea[]
  ideas: IdeaDraft[]
  outputCount?: number
  completionNote?: string
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const timeLabel = (hour: number, half = false) => `${hour % 12 === 0 ? 12 : hour % 12}:${half ? '30' : '00'} ${hour < 12 ? 'AM' : 'PM'}`
export function parseTimeLabel(label: string): number {
  const m = label.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 10
  let h = Number.parseInt(m[1], 10) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return h
}

function titleCase(s: string): string {
  const clean = s.replace(/[#"]/g, '').replace(/[.:;]+$/, '').trim()
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

registerSkill<PlanPayload>('calendar.idea.form', (p, ctx) => {
  const max = ctx.num('maxIdeasPerRun')
  const ideas: IdeaDraft[] = p.opportunities.slice(0, max).map((c, i) => ({
    key: `idea:${c.sourceKey}`,
    title: titleCase(c.title).slice(0, 96),
    description: `${c.angle} ${c.explanation}`.trim(),
    sourceTopic: c.keywordTerm,
    sourceKey: c.sourceKey,
    hashtagTag: c.hashtagTag,
    hashtagDisplay: c.hashtagDisplay,
    platform: 'linkedin',
    altPlatforms: [],
    date: '',
    time: '10:30 AM',
    hour: 10,
    confidence: 0,
    priorityScore: 0,
    platformRank: i + 1,
    calendarSlot: 'suggestion',
    analysis: { brandRelevance: c.brandRelevance, trendScore: c.trendScore, engagementLevel: c.engagementLevel, engagementScore: c.engagementScore, format: c.format, bestDay: c.bestDay, angle: c.angle, audience: c.audience, hashtag: c.hashtagDisplay, keyword: c.keywordTerm, slotReasons: [], platformScores: { linkedin: 0, instagram: 0, x: 0 }, explanation: c.explanation, competitorNote: c.competitorNote },
    isNewTrend: true,
  }))
  ctx.log(`${ideas.length} ideas formed`)
  return { ideas }
})

registerSkill<PlanPayload>('calendar.idea.dedupe', (p, ctx) => {
  const t = ctx.num('similarityThreshold') / 100
  const kept = p.ideas.filter((i) => !p.existingIdeas.some((e) => similarity(e.title, i.title) >= t))
  ctx.log(`${p.ideas.length - kept.length} ideas dropped as near-duplicates of the calendar`)
  return { ideas: kept }
})

registerSkill<PlanPayload>('calendar.slot.optimize', (p, ctx) => {
  const start = ctx.num('preferredWindowStart')
  const end = ctx.num('preferredWindowEnd')
  const avoidWeekends = ctx.bool('avoidWeekends')
  const horizon = ctx.num('horizonDays')
  const days: Date[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  cursor.setDate(cursor.getDate() + 1)
  while (days.length < horizon) {
    if (!avoidWeekends || (cursor.getDay() !== 0 && cursor.getDay() !== 6)) days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  const hours = HOUR_WEIGHTS.map((w, h) => ({ h, w })).filter(({ h }) => h >= start && h <= end).sort((a, b) => b.w - a.w)
  const dayRank = [...days].sort((a, b) => (DAY_WEIGHTS[b.getDay()] ?? 0) - (DAY_WEIGHTS[a.getDay()] ?? 0))
  p.ideas.forEach((idea, i) => {
    // Strongest ideas take the strongest days; spread deterministically across the horizon.
    const preferredIdx = days.findIndex((d) => WEEKDAYS[d.getDay()] === idea.analysis.bestDay)
    const day = i < 3 && preferredIdx >= 0 ? days[preferredIdx] : days[i % days.length]
    const slot = hours[Math.floor(i / days.length) % Math.max(1, hours.length)] ?? hours[0]
    idea.date = iso(day)
    idea.hour = slot.h
    idea.time = timeLabel(slot.h, i % 2 === 1)
    const dayW = DAY_WEIGHTS[day.getDay()] ?? 0
    const dayPos = dayRank.findIndex((d) => d.getDay() === day.getDay()) + 1
    idea.analysis.slotReasons = [
      `${WEEKDAYS[day.getDay()]} carries a day weight of ${dayW.toFixed(2)} in this account's history — its ${dayPos <= 1 ? 'strongest' : `${dayPos}${dayPos === 2 ? 'nd' : dayPos === 3 ? 'rd' : 'th'} strongest`} weekday.`,
      `${timeLabel(slot.h)} has an hour weight of ${slot.w.toFixed(2)}, inside the ${timeLabel(start)}–${timeLabel(end)} window.`,
      `The Analysis Agent named ${idea.analysis.bestDay} as the best day for "${idea.sourceTopic}" content (${idea.analysis.format}).`,
      `${p.ideas.filter((o) => o.date === idea.date).length - 1} other idea(s) already share this date, keeping the week spread.`,
    ]
  })
  ctx.log(`Slots assigned across ${days.length} day(s), ${hours.length} candidate hours`)
  return { ideas: p.ideas }
})

registerSkill<PlanPayload>('calendar.platform.select', (p, ctx) => {
  const primary = ctx.str('primaryPlatform') as Platform
  const alt = ctx.num('alternateThreshold')
  for (const idea of p.ideas) {
    const fit = PLATFORM_FIT[idea.analysis.format]
    idea.analysis.platformScores = { ...fit }
    let best: Platform = primary
    for (const pl of PLATFORMS) if (fit[pl] > fit[best] || (fit[pl] === fit[best] && pl === primary)) best = pl
    idea.platform = best
    idea.altPlatforms = PLATFORMS.filter((pl) => pl !== best && fit[pl] >= alt).map((pl) => ({ platform: pl, score: fit[pl] }))
    idea.confidence = Math.round((fit[best] + idea.analysis.brandRelevance) / 2)
  }
  ctx.log(`Platforms chosen (primary ${primary}, alternates ≥ ${alt})`)
  return { ideas: p.ideas }
})

registerSkill<PlanPayload>('calendar.cadence.balance', (p, ctx) => {
  const maxDay = ctx.num('maxPerDay')
  const maxPlat = ctx.num('maxPerPlatformPerDay')
  const perDay = new Map<string, number>()
  const perPlat = new Map<string, number>()
  for (const e of p.existingIdeas) {
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1)
    perPlat.set(`${e.date}|${e.platform}`, (perPlat.get(`${e.date}|${e.platform}`) ?? 0) + 1)
  }
  let moved = 0
  for (const idea of p.ideas) {
    let guard = 0
    while (((perDay.get(idea.date) ?? 0) >= maxDay || (perPlat.get(`${idea.date}|${idea.platform}`) ?? 0) >= maxPlat) && guard < 14) {
      const d = new Date(idea.date + 'T12:00:00')
      d.setDate(d.getDate() + 1)
      if (d.getDay() === 6) d.setDate(d.getDate() + 2)
      if (d.getDay() === 0) d.setDate(d.getDate() + 1)
      idea.date = iso(d)
      guard++
      moved++
    }
    perDay.set(idea.date, (perDay.get(idea.date) ?? 0) + 1)
    perPlat.set(`${idea.date}|${idea.platform}`, (perPlat.get(`${idea.date}|${idea.platform}`) ?? 0) + 1)
  }
  ctx.log(`${moved} shift(s) to respect ${maxDay}/day and ${maxPlat}/platform/day`)
  return { ideas: p.ideas }
})

registerSkill<PlanPayload>('calendar.conflict.detect', (p, ctx) => {
  const gap = ctx.num('minGapHours')
  let conflicts = 0
  const all = [...p.existingIdeas.map((e) => ({ date: e.date, platform: e.platform, hour: e.hour ?? 10, title: e.title })), ...p.ideas.map((i) => ({ date: i.date, platform: i.platform, hour: i.hour, title: i.title }))]
  for (const idea of p.ideas) {
    const clash = all.filter((o) => o !== undefined && o.title !== idea.title && o.date === idea.date && o.platform === idea.platform && Math.abs(o.hour - idea.hour) < gap)
    if (clash.length) {
      idea.hour = Math.min(18, idea.hour + gap)
      idea.time = timeLabel(idea.hour)
      idea.analysis.conflicts = clash.map((c) => `Moved ${gap}h later to clear "${c.title}" on the same platform.`)
      conflicts++
    }
  }
  ctx.log(`${conflicts} conflict(s) resolved with a ${gap}h gap`)
  return { ideas: p.ideas }
})

registerSkill<PlanPayload>('calendar.crossplatform.adapt', (p, ctx) => {
  if (!ctx.bool('suggestAlternates')) return
  const notes: Record<Platform, string> = {
    linkedin: 'Keep the full nine-stage structure; cite the source inline.',
    instagram: 'Lead with the headline on the creative; break the body into short lines; carousel if the evidence has 3+ points.',
    x: 'Compress to the hook and one line of evidence; three hashtags at most.',
  }
  for (const idea of p.ideas) idea.analysis.adaptNotes = Object.fromEntries(idea.altPlatforms.map((a) => [a.platform, notes[a.platform]])) as Partial<Record<Platform, string>>
  ctx.log('Adaptation notes attached for alternates')
  return { ideas: p.ideas }
})

export function rankIdeas<T extends { platform: Platform; confidence: number; analysis: { brandRelevance: number; trendScore: number }; priorityScore: number; platformRank: number; calendarSlot: 'primary' | 'suggestion' }>(
  ideas: T[], cfg: { topPerPlatform: number; confidenceWeight: number; relevanceWeight: number; trendWeight: number; balance: boolean },
): T[] {
  const sum = cfg.confidenceWeight + cfg.relevanceWeight + cfg.trendWeight || 100
  for (const i of ideas) i.priorityScore = Math.round((i.confidence * cfg.confidenceWeight + i.analysis.brandRelevance * cfg.relevanceWeight + i.analysis.trendScore * cfg.trendWeight) / sum)
  const groups = cfg.balance ? PLATFORMS.map((pl) => ideas.filter((i) => i.platform === pl)) : [ideas]
  for (const g of groups) {
    g.sort((a, b) => b.priorityScore - a.priorityScore)
    g.forEach((i, idx) => {
      i.platformRank = idx + 1
      i.calendarSlot = idx < cfg.topPerPlatform ? 'primary' : 'suggestion'
    })
  }
  return ideas
}

registerSkill<PlanPayload>('calendar.rank.select', (p, ctx) => {
  const top = ctx.num('topPerPlatform')
  // Rank new ideas together with what is already on the calendar so the top-10 rule holds globally.
  const existing = p.existingIdeas.filter((e) => e.status !== 'published' && e.status !== 'rejected').map((e) => ({ ...e, confidence: e.confidence ?? 60, priorityScore: e.priorityScore ?? 0, platformRank: 99, calendarSlot: e.calendarSlot ?? 'suggestion', analysis: { brandRelevance: e.priorityScore ?? 60, trendScore: e.priorityScore ?? 60 }, isExisting: true as const }))
  const pool = [...p.ideas.map((i) => ({ ...i, isExisting: false as const })), ...existing]
  rankIdeas(pool, { topPerPlatform: top, confidenceWeight: ctx.num('rankConfidenceWeight'), relevanceWeight: ctx.num('rankRelevanceWeight'), trendWeight: ctx.num('rankTrendWeight'), balance: ctx.bool('balanceAcrossPlatforms') })
  for (const idea of p.ideas) {
    const ranked = pool.find((x) => !x.isExisting && (x as IdeaDraft).key === idea.key)
    if (ranked) { idea.priorityScore = ranked.priorityScore; idea.platformRank = ranked.platformRank; idea.calendarSlot = ranked.calendarSlot }
    ctx.emit('idea.ranked', `#${idea.platformRank} ${idea.platform} · ${idea.title}`, { key: idea.key, platform: idea.platform, rank: idea.platformRank, slot: idea.calendarSlot, priorityScore: idea.priorityScore })
  }
  const primary = p.ideas.filter((i) => i.calendarSlot === 'primary').length
  ctx.log(`${primary} on the calendar, ${p.ideas.length - primary} in More suggestions (top ${top} per platform)`)
  return { ideas: p.ideas, outputCount: p.ideas.length, completionNote: `${primary} placed · ${p.ideas.length - primary} suggestions` }
})
