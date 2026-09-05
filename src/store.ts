// One global Zustand store. Every action works standalone and upgrades to the runtime when it is reachable.
import { create } from 'zustand'
import { AGENT_BY_ID, defaultSkillConfig, type AgentId } from '../shared/agent-registry'
import { BRAND, type BrandCheck } from '../shared/brand-voice'
import { USERS, applyTopRuleLocal, buildInitialState, iso } from './data/initial'
import { api, detectApi, subscribeToEvents } from './lib/api'
import { answerSocialQuestion, applyInstructionLocal, checkCaption, writeCaptionLocal } from './lib/ai'
import { headlineFor, renderBrandLocal } from './lib/image-gen'
import type { ActivityEvent, AgentState, AgentStatus, ApiMode, HealthResponse, Idea, KnowledgeEntry, Page, PipelineEvent, PipelineResult, Platform, Role, StateSnapshot, Theme, Toast, User, Validation } from './types'

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-ink-3' },
  running: { label: 'Running', dot: 'bg-accent anim-pulse-dot' },
  completed: { label: 'Completed', dot: 'bg-good' },
  waiting: { label: 'Waiting', dot: 'bg-warn' },
  needs_review: { label: 'Needs review', dot: 'bg-serious' },
  failed: { label: 'Failed', dot: 'bg-critical' },
}

export interface Settings {
  tone: string; audience: string; creativity: number; approvalRequired: boolean; autoScheduling: boolean; autoPublish: boolean; imageModel: string
  topKeywords: number; topHashtagsPerKeyword: number; knowledgeHashtagCount: number; topPerPlatform: number
}

export interface ScrapeRun { running: boolean; progress: number; currentSource: string; currentKeyword: string; found: number }

interface Store extends StateSnapshot {
  page: Page; user: User | null; theme: Theme; introOpen: boolean; knowledgeOpen: boolean; reviewIdeaId: string | null; theaterOpen: boolean
  toasts: Toast[]; scrapeRun: ScrapeRun; validating: boolean; publishPhase: number; publishingIdeaId: string | null; building: boolean
  scrapeRunCount: number; apiMode: ApiMode; apiHealth: HealthResponse | null; settings: Settings; lastPipelineResult: PipelineResult | null
  events: PipelineEvent[]; failedAgent: AgentId | null; connected: boolean
  setPage: (p: Page) => void; login: (role: Role) => void; logout: () => void; setTheme: (t: Theme) => void; toggleTheme: () => void
  openKnowledge: () => void; closeKnowledge: () => void; openReview: (id: string) => void; closeReview: () => void; openTheater: () => void; closeTheater: () => void; closeIntro: () => void
  connectToRuntime: () => Promise<boolean>; refreshState: () => Promise<void>
  runScraping: () => Promise<PipelineResult | null>; runValidation: () => Promise<void>
  setValidation: (id: string, verdict: Validation) => Promise<void>; setHashtagValidation: (id: string, verdict: Validation) => Promise<void>; resolveReview: (id: string, outcome: string) => Promise<void>
  promoteKeyword: (term: string) => Promise<void>; addKeyword: (b: { term: string; category: string; weight: number }) => Promise<void>; updateKeyword: (id: string, patch: { term?: string; category?: string; weight?: number; active?: boolean }) => Promise<void>; removeKeyword: (id: string) => Promise<void>
  buildKnowledge: () => Promise<void>
  ensureDraft: (id: string, platform: Platform) => Promise<void>; regenerateDraft: (id: string, platform: Platform) => Promise<void>
  ensureImage: (id: string, platform: Platform) => Promise<void>; regenerateImage: (id: string, platform: Platform, opts?: { model?: string; prompt?: string; instruction?: string }) => Promise<void>; instructImage: (id: string, platform: Platform, instruction: string) => Promise<void>
  instructAI: (id: string, platform: Platform, instruction: string) => Promise<{ text: string; note: string; learnable?: { title: string; content: string; category: string } | null; check: BrandCheck }>
  updateDraft: (id: string, platform: Platform, body: string) => void; saveDraft: (id: string, platform: Platform) => Promise<void>
  moveIdea: (id: string, date: string) => Promise<void>; promoteIdea: (id: string) => Promise<void>; demoteIdea: (id: string) => Promise<void>; setIdeaTime: (id: string, time: string) => Promise<void>; setIdeaPlatform: (id: string, platform: Platform) => Promise<void>
  duplicateIdea: (id: string) => Promise<void>; deleteIdea: (id: string) => Promise<void>; addIdeaFromItem: (itemId: string) => Promise<string | null>
  approveIdea: (id: string) => Promise<void>; leadershipApprove: (id: string) => Promise<void>; leadershipReject: (id: string, reason: string) => Promise<void>; publishIdea: (id: string) => Promise<void>
  addKnowledge: (b: { title: string; category: string; content: string; source?: string }) => Promise<void>; toggleKnowledge: (id: string) => Promise<void>
  pushActivity: (ev: Omit<ActivityEvent, 'id' | 'at'>) => void; setAgent: (id: AgentId, patch: Partial<AgentState>) => void
  toast: (kind: Toast['kind'], title: string, body?: string) => void; dismissToast: (id: number) => void; updateSettings: (patch: Partial<Settings>) => void
  simulateFailure: () => void; retryFailed: () => Promise<void>; refreshAnalytics: () => Promise<void>; askIntelligence: (question: string, month: string) => string
  pushEvent: (e: PipelineEvent) => void; clearEvents: () => void
}

let toastSeq = 1
let evSeq = 1
let inflightRun: Promise<PipelineResult | null> | null = null
const now = () => new Date().toISOString()
const storedTheme = (typeof localStorage !== 'undefined' ? (localStorage.getItem('ethara-theme') as Theme | null) : null) ?? 'dark'
const currentUserName = (get: () => Store) => get().user?.name ?? 'Marketing'

export const useStore = create<Store>((set, get) => {
  const demo = buildInitialState()
  const patchIdea = (id: string, fn: (i: Idea) => Idea) => set((s) => ({ ideas: s.ideas.map((i) => (i.id === id ? fn(i) : i)) }))
  const idea = (id: string) => get().ideas.find((i) => i.id === id)
  const live = () => get().apiMode === 'live'
  const localDraft = (id: string, platform: Platform) => {
    const i = idea(id); if (!i) return
    const body = writeCaptionLocal(i, platform, get().knowledge)
    patchIdea(id, (x) => ({ ...x, status: x.status === 'suggested' ? 'drafted' : x.status, drafts: { ...x.drafts, [platform]: { platform, body, revision: (x.drafts[platform]?.revision ?? 0) + 1, generatedBy: 'caption', model: 'ethara-writer', source: 'fixture', updatedAt: now() } } }))
    localImage(id, platform, { fallbackReason: get().integrations.gcp.reason })
  }
  const localImage = (id: string, platform: Platform, opts: { instruction?: string; model?: string; fallbackReason?: string | null; variant?: number } = {}) => {
    const i = idea(id); if (!i) return
    const caption = i.drafts[platform]?.body ?? i.title
    const media = renderBrandLocal(i, platform, caption, { instruction: opts.instruction, model: opts.model === 'brand-svg' || !opts.model ? 'brand-svg' : 'brand-svg', fallbackReason: opts.fallbackReason ?? (opts.model && opts.model !== 'brand-svg' ? `${opts.model} needs the agent runtime — rendered with the local brand layer instead` : null), variant: opts.variant })
    patchIdea(id, (x) => ({ ...x, media: { ...x.media, [platform]: media } }))
  }

  return {
    ...demo,
    page: 'dashboard', user: null, theme: storedTheme, introOpen: false, knowledgeOpen: false, reviewIdeaId: null, theaterOpen: false,
    toasts: [], scrapeRun: { running: false, progress: 0, currentSource: '', currentKeyword: '', found: 0 }, validating: false, publishPhase: -1, publishingIdeaId: null, building: false,
    scrapeRunCount: 0, apiMode: 'standalone', apiHealth: null, lastPipelineResult: null, events: [], failedAgent: null, connected: false,
    settings: { tone: BRAND.voice.join(', '), audience: 'AI researchers, ML engineers and engineering leaders evaluating post-training and agentic systems.', creativity: 60, approvalRequired: true, autoScheduling: true, autoPublish: true, imageModel: 'brand-svg', topKeywords: 5, topHashtagsPerKeyword: 5, knowledgeHashtagCount: 25, topPerPlatform: 10 },

    setPage: (page) => set({ page }),
    login: (role) => set({ user: USERS[role], page: role === 'marketing' ? 'dashboard' : 'leadership', introOpen: true }),
    logout: () => set({ user: null, introOpen: false, knowledgeOpen: false, reviewIdeaId: null, theaterOpen: false }),
    setTheme: (theme) => { localStorage.setItem('ethara-theme', theme); document.documentElement.setAttribute('data-theme', theme); set({ theme }) },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    openKnowledge: () => set({ knowledgeOpen: true }), closeKnowledge: () => set({ knowledgeOpen: false }),
    openReview: (id) => set({ reviewIdeaId: id }), closeReview: () => set({ reviewIdeaId: null }),
    openTheater: () => set({ theaterOpen: true }), closeTheater: () => set({ theaterOpen: false }), closeIntro: () => set({ introOpen: false }),

    connectToRuntime: async () => {
      const health = await detectApi(1500)
      if (!health) { set({ apiMode: 'standalone', apiHealth: null, connected: false }); return false }
      try {
        const state = await api.state()
        set({ ...state, apiMode: 'live', apiHealth: health, connected: true })
        subscribeToEvents((e) => get().pushEvent(e), () => { void get().refreshState() })
        return true
      } catch {
        set({ apiMode: 'standalone', apiHealth: health, connected: false })
        return false
      }
    },
    refreshState: async () => {
      if (!live()) return
      try { const state = await api.state(); set((s) => ({ ...state, ideas: state.ideas.map((i) => { const cur = s.ideas.find((x) => x.id === i.id); return cur ? { ...i, drafts: { ...cur.drafts, ...i.drafts }, media: { ...cur.media, ...i.media } } : i }) })) } catch { /* keep current state */ }
    },

    runScraping: () => {
      // A second caller (StrictMode double-mount, a second button press) shares the in-flight run instead of getting null.
      if (inflightRun) return inflightRun
      inflightRun = (async (): Promise<PipelineResult | null> => {
      set({ scrapeRun: { running: true, progress: 2, currentSource: 'LinkedIn', currentKeyword: get().keywords[0]?.term ?? '', found: 0 }, failedAgent: null })
      get().setAgent('scraping', { status: 'running', currentTask: 'Scanning LinkedIn for the keyword set' })
      try {
        let result: PipelineResult
        if (live()) {
          result = await api.runPipeline({})
          await get().refreshState()
        } else {
          throw new Error('The agent runtime is not reachable — start the API (npm run dev:server) so the Scraping Agent can call Apify.')
        }
        set((s) => ({ lastPipelineResult: result, scrapeRunCount: s.scrapeRunCount + 1, scrapeRun: { running: false, progress: 100, currentSource: '', currentKeyword: '', found: Number(result.summary.postsScraped) } }))
        if (result.status === 'failed') { set({ failedAgent: 'scraping' }); get().toast('error', 'Pipeline failed', result.error) }
        return result
      } catch (err) {
        set({ scrapeRun: { running: false, progress: 0, currentSource: '', currentKeyword: '', found: 0 }, failedAgent: 'scraping' })
        get().setAgent('scraping', { status: 'failed', currentTask: err instanceof Error ? err.message : 'Pipeline failed' })
        get().toast('error', 'Pipeline failed', err instanceof Error ? err.message : String(err))
        return null
      }
      })()
      return inflightRun.finally(() => { inflightRun = null })
    },
    runValidation: async () => {
      set({ validating: true })
      get().setAgent('validation', { status: 'running', currentTask: 'Re-scoring pending items' })
      if (live()) { await api.runPipeline({}); await get().refreshState() }
      else get().toast('error', 'Agent runtime not reachable', 'Validation runs inside the runtime — start the API first.')
      const open = get().reviewQueue.length
      get().setAgent('validation', { status: open ? 'needs_review' : 'completed', currentTask: open ? `${open} decision(s) waiting for a human` : 'Review queue clear', lastRun: now() })
      set({ validating: false })
    },
    setValidation: async (id, verdict) => {
      const by = currentUserName(get)
      set((s) => ({ scraped: s.scraped.map((it) => (it.id === id ? { ...it, validation: verdict, validatedAt: now(), verdictReason: `${verdict === 'validated' ? 'Approved' : 'Rejected'} by ${by} — ${it.verdictReason ?? ''}` } : it)), reviewQueue: s.reviewQueue.filter((r) => r.entityId !== id) }))
      get().pushActivity({ agentId: 'validation', message: `"${idea(id)?.title ?? get().scraped.find((s) => s.id === id)?.title ?? 'Item'}" marked ${verdict} by ${by}`, status: 'ok' })
      if (live()) { try { await api.setItemValidation(id, verdict, by) } catch (e) { get().toast('error', 'Could not save verdict', String(e)) } }
      if (!get().reviewQueue.length) get().setAgent('validation', { status: 'completed', currentTask: 'Review queue clear' })
    },
    setHashtagValidation: async (id, verdict) => {
      const by = currentUserName(get)
      set((s) => ({ hashtags: s.hashtags.map((h) => (h.id === id ? { ...h, validation: verdict, validatedAt: now() } : h)), reviewQueue: s.reviewQueue.filter((r) => r.entityId !== id) }))
      const h = get().hashtags.find((x) => x.id === id)
      get().pushActivity({ agentId: 'validation', message: `#${h?.displayTag ?? ''} marked ${verdict} by ${by}`, status: 'ok' })
      if (live()) { try { await api.setHashtagValidation(id, verdict, by) } catch (e) { get().toast('error', 'Could not save verdict', String(e)) } }
    },
    resolveReview: async (id, outcome) => {
      const r = get().reviewQueue.find((x) => x.id === id); if (!r) return
      const verdict: Validation = /approve|keep/i.test(outcome) ? 'validated' : 'rejected'
      if (r.kind === 'scraped_item') await get().setValidation(r.entityId, verdict)
      else if (r.kind === 'hashtag') await get().setHashtagValidation(r.entityId, verdict)
      else { set((s) => ({ reviewQueue: s.reviewQueue.filter((x) => x.id !== id) })); if (live()) { try { await api.resolveReview(id, outcome, currentUserName(get)) } catch { /* soft */ } } }
    },
    promoteKeyword: async (term) => {
      const existing = get().keywords.find((k) => k.term.toLowerCase() === term.toLowerCase())
      if (existing) await get().updateKeyword(existing.id, { weight: Math.min(100, existing.weight + 10), active: true })
      else await get().addKeyword({ term, category: 'Adjacent', weight: 60 })
      get().toast('success', 'Keyword promoted', `"${term}" will be scraped on the next run.`)
    },
    addKeyword: async (b) => {
      if (live()) { try { const k = await api.keywords.create(b); set((s) => ({ keywords: [...s.keywords, k] })); return } catch (e) { get().toast('error', 'Could not add keyword', String(e)); return } }
      set((s) => ({ keywords: [...s.keywords, { id: `kw-${Date.now()}`, ...b, active: true }] }))
    },
    updateKeyword: async (id, patch) => {
      set((s) => ({ keywords: s.keywords.map((k) => (k.id === id ? { ...k, ...patch } : k)) }))
      if (live()) { try { await api.keywords.update(id, patch) } catch (e) { get().toast('error', 'Could not update keyword', String(e)) } }
    },
    removeKeyword: async (id) => {
      set((s) => ({ keywords: s.keywords.map((k) => (k.id === id ? { ...k, active: false } : k)) }))
      if (live()) { try { await api.keywords.remove(id) } catch (e) { get().toast('error', 'Could not remove keyword', String(e)) } }
      get().toast('info', 'Keyword deactivated', 'Nothing is deleted — its signal history is kept.')
    },

    buildKnowledge: async () => {
      if (get().building) return
      set({ building: true })
      get().setAgent('knowledge', { status: 'running', currentTask: 'Researching the top hashtags' })
      try {
        if (live()) { const b = await api.knowledge.build({ hashtagCount: get().settings.knowledgeHashtagCount }); await get().refreshState(); get().toast('success', 'Knowledge Base rebuilt', `${b.entriesWritten} written · ${b.entriesMerged} merged from ${b.hashtagsResearched} hashtags (${b.researchSource})`) }
        else throw new Error('The agent runtime is not reachable — start the API so the Knowledge Agent can call Parallel Web Systems.')
        get().pushActivity({ agentId: 'knowledge', message: 'Knowledge build completed on demand', status: 'ok' })
        get().setAgent('knowledge', { status: 'completed', currentTask: 'Knowledge Base rebuilt', lastRun: now() })
      } catch (e) { get().toast('error', 'Knowledge build failed', String(e)); get().setAgent('knowledge', { status: 'failed', currentTask: String(e) }) }
      set({ building: false })
    },

    ensureDraft: async (id, platform) => { if (idea(id)?.drafts[platform]) return; await get().regenerateDraft(id, platform) },
    regenerateDraft: async (id, platform) => {
      get().setAgent('caption', { status: 'running', currentTask: `Writing "${idea(id)?.title.slice(0, 40) ?? ''}"` })
      localDraft(id, platform)
      if (live()) {
        try {
          const r = await api.ideas.draft(id, platform)
          patchIdea(id, (x) => ({ ...x, status: x.status === 'suggested' ? 'drafted' : x.status, drafts: { ...x.drafts, [platform]: r.draft }, media: r.media ? { ...x.media, [platform]: r.media } : x.media }))
          if (r.voice.fallbackReason) get().pushActivity({ agentId: 'caption', message: `Template writer used — ${r.voice.fallbackReason}`, status: 'warn' })
        } catch (e) { get().toast('error', 'Runtime draft failed — local draft kept', String(e)) }
      }
      get().setAgent('caption', { status: 'completed', currentTask: `Draft written for ${platform}`, lastRun: now() })
      get().setAgent('image', { status: 'completed', currentTask: 'Creative rendered with the brand layer', lastRun: now() })
    },
    ensureImage: async (id, platform) => { if (idea(id)?.media[platform]) return; await get().regenerateImage(id, platform) },
    regenerateImage: async (id, platform, opts = {}) => {
      get().setAgent('image', { status: 'running', currentTask: `Rendering the ${platform} creative` })
      const model = opts.model ?? get().settings.imageModel
      localImage(id, platform, { instruction: opts.instruction, model, variant: Math.floor(Math.random() * 4) })
      if (live()) {
        try { const r = await api.ideas.image(id, { platform, model, prompt: opts.prompt, instruction: opts.instruction }); patchIdea(id, (x) => ({ ...x, media: { ...x.media, [platform]: r.media } })); if (r.media.fallbackReason) get().pushActivity({ agentId: 'image', message: r.media.fallbackReason, status: 'warn' }) }
        catch (e) { get().toast('error', 'Runtime render failed — local render kept', String(e)) }
      }
      get().setAgent('image', { status: 'completed', currentTask: 'Creative rendered', lastRun: now() })
    },
    instructImage: async (id, platform, instruction) => get().regenerateImage(id, platform, { instruction }),
    instructAI: async (id, platform, instruction) => {
      const i = idea(id); if (!i) throw new Error('Idea not found')
      if (!i.drafts[platform]) localDraft(id, platform)
      const cur = idea(id) as Idea
      const local = applyInstructionLocal(cur.drafts[platform]?.body ?? '', instruction, cur)
      const media = cur.media[platform]
      let text = local.text; let note = local.note; let learnable = local.learnable
      let check = checkCaption(text, platform, `${cur.sourceTopic} ${cur.title}`, media ? { headline: headlineFor(text, cur.title), hasAltText: Boolean(media.altText) } : undefined)
      get().setAgent('review', { status: 'running', currentTask: 'Applying an edit instruction' })
      if (live()) {
        try { const r = await api.ideas.instruct(id, platform, instruction); text = r.draft.body; note = r.note; check = r.compliance; learnable = r.preference }
        catch (e) { get().toast('error', 'Runtime review failed — local edit applied', String(e)) }
      }
      patchIdea(id, (x) => ({ ...x, status: x.status === 'suggested' || x.status === 'drafted' ? 'in_review' : x.status, feedback: [...x.feedback, { instruction, at: now(), note }], drafts: { ...x.drafts, [platform]: { ...(x.drafts[platform] ?? { platform, generatedBy: 'review', model: 'ethara-writer', source: 'fixture' as const, revision: 0 }), body: text, revision: (x.drafts[platform]?.revision ?? 0) + 1, generatedBy: 'review', updatedAt: now() } } }))
      get().pushActivity({ agentId: 'review', message: `Applied "${instruction.slice(0, 50)}" — ${check.verdict}`, status: local.conflicts.length ? 'warn' : 'ok' })
      get().setAgent('review', { status: 'completed', currentTask: `Instruction applied · ${check.verdict}`, lastRun: now() })
      return { text, note, learnable, check }
    },
    updateDraft: (id, platform, body) => patchIdea(id, (x) => ({ ...x, drafts: { ...x.drafts, [platform]: { ...(x.drafts[platform] ?? { platform, generatedBy: 'human', model: 'manual', source: 'fixture' as const, revision: 0 }), body, generatedBy: 'human', updatedAt: now() } } })),
    saveDraft: async (id, platform) => { if (!live()) return; const body = idea(id)?.drafts[platform]?.body; if (body === undefined) return; try { await api.ideas.patch(id, { draft: body, platform }) } catch { /* soft */ } },

    moveIdea: async (id, date) => {
      patchIdea(id, (x) => ({ ...x, date }))
      get().pushActivity({ agentId: 'calendar', message: `"${idea(id)?.title.slice(0, 40)}" moved to ${date}`, status: 'ok' })
      if (live()) { try { await api.ideas.patch(id, { date }) } catch (e) { get().toast('error', 'Could not move idea', String(e)) } }
    },
    promoteIdea: async (id) => {
      const i = idea(id); if (!i) return
      if (live()) {
        try { const r = await api.ideas.patch(id, { calendarSlot: 'primary' }); await get().refreshState(); get().toast('success', 'Promoted to the calendar', r.demoted ? `'${r.demoted.title}' moved to More suggestions to make room.` : undefined); return } catch (e) { get().toast('error', 'Could not promote', String(e)); return }
      }
      const top = get().settings.topPerPlatform
      const primaries = get().ideas.filter((x) => x.platform === i.platform && x.calendarSlot === 'primary' && x.status !== 'published' && x.status !== 'rejected').sort((a, b) => a.priorityScore - b.priorityScore)
      const demoted = primaries.length >= top ? primaries[0] : null
      const floor = primaries[0]?.priorityScore ?? 50
      const ideas = applyTopRuleLocal(get().ideas.map((x) => (x.id === id ? { ...x, priorityScore: Math.min(100, floor + 1) } : x)), top)
      set({ ideas })
      get().toast('success', 'Promoted to the calendar', demoted ? `'${demoted.title}' moved to More suggestions to make room.` : undefined)
    },
    demoteIdea: async (id) => {
      const i = idea(id); if (!i) return
      if (live()) { try { const r = await api.ideas.patch(id, { calendarSlot: 'suggestion' }); await get().refreshState(); get().toast('info', 'Moved to More suggestions', r.promoted ? `'${r.promoted.title}' took the slot.` : undefined); return } catch (e) { get().toast('error', 'Could not demote', String(e)); return } }
      const lowest = Math.min(...get().ideas.filter((x) => x.platform === i.platform).map((x) => x.priorityScore))
      const before = get().ideas.filter((x) => x.platform === i.platform && x.calendarSlot === 'suggestion')
      const ideas = applyTopRuleLocal(get().ideas.map((x) => (x.id === id ? { ...x, priorityScore: Math.max(0, lowest - 1) } : x)), get().settings.topPerPlatform)
      set({ ideas })
      const promoted = before.find((b) => ideas.find((x) => x.id === b.id)?.calendarSlot === 'primary')
      get().toast('info', 'Moved to More suggestions', promoted ? `'${promoted.title}' took the slot.` : undefined)
    },
    setIdeaTime: async (id, time) => { patchIdea(id, (x) => ({ ...x, time })); if (live()) { try { await api.ideas.patch(id, { time }) } catch { /* soft */ } } },
    setIdeaPlatform: async (id, platform) => {
      patchIdea(id, (x) => ({ ...x, platform }))
      await get().regenerateDraft(id, platform)
      if (live()) { try { await api.ideas.patch(id, { platform }); await get().refreshState() } catch { /* soft */ } } else set((s) => ({ ideas: applyTopRuleLocal([...s.ideas], s.settings.topPerPlatform) }))
    },
    duplicateIdea: async (id) => {
      const i = idea(id); if (!i) return
      const copy: Idea = { ...i, id: `${i.id}-copy-${Date.now()}`, title: `${i.title} (copy)`, status: 'suggested', calendarSlot: 'suggestion', platformRank: 99, marketingApprovedBy: null, marketingApprovedAt: null, leadershipDecision: null, feedback: [], createdAt: now() }
      set((s) => ({ ideas: applyTopRuleLocal([...s.ideas, copy], s.settings.topPerPlatform) }))
      get().toast('info', 'Idea duplicated', 'The copy sits in More suggestions until you promote it.')
    },
    deleteIdea: async (id) => {
      patchIdea(id, (x) => ({ ...x, status: 'rejected', leadershipDecision: { by: currentUserName(get), decision: 'rejected', reason: 'Removed from the calendar by Marketing', at: now() } }))
      set((s) => ({ ideas: applyTopRuleLocal([...s.ideas], s.settings.topPerPlatform) }))
      if (live()) { try { await api.ideas.remove(id); await get().refreshState() } catch { /* soft */ } }
      get().toast('info', 'Removed from the calendar', 'Kept as rejected — nothing is deleted.')
    },
    addIdeaFromItem: async (itemId) => {
      const it = get().scraped.find((s) => s.id === itemId); if (!it) return null
      const existing = get().ideas.find((i) => i.sourceItemId === itemId)
      if (existing) return existing.id
      const d = new Date(); d.setDate(d.getDate() + 2 + (get().ideas.length % 5)); if (d.getDay() === 6) d.setDate(d.getDate() + 2); if (d.getDay() === 0) d.setDate(d.getDate() + 1)
      const title = it.title.replace(/[#"]/g, '').replace(/[.:;]+$/, '')
      const fresh: Idea = { id: `idea-${itemId}`, sourceItemId: itemId, hashtagId: null, hashtag: it.hashtags[0] ?? null, title: title.charAt(0).toUpperCase() + title.slice(1), description: `The mechanism behind ${it.keyword}: what actually changes when ${title.toLowerCase()}.`, sourceTopic: it.keyword, platform: 'linkedin', altPlatforms: [{ platform: 'x', score: 74 }], date: iso(d), time: '10:30 AM', confidence: Math.round((94 + it.relevance) / 2), priorityScore: Math.round((it.relevance * 0.8 + 20)), platformRank: 99, calendarSlot: 'suggestion', status: 'suggested', analysis: { brandRelevance: it.relevance, trendScore: get().keywordSignals.find((s) => s.keywordId === it.keywordId)?.trendScore ?? 60, engagementLevel: it.engagement > 1500 ? 'High' : 'Medium', engagementScore: Math.min(100, Math.round(it.engagement / 25)), format: 'Thought Leadership', bestDay: 'Tuesday', angle: `The mechanism behind ${it.keyword}.`, audience: 'ML researchers and post-training engineers', hashtag: it.hashtags[0], keyword: it.keyword ?? undefined, slotReasons: ['Placed on the next strong weekday with a free slot.', '10:30 AM sits at the top of the hour-weight table.', 'Thought Leadership is the default format for a validated LinkedIn post.', 'Spread against the other ideas already placed.'], platformScores: { linkedin: 94, instagram: 52, x: 74 } }, feedback: [], isNewTrend: true, marketingApprovedBy: null, marketingApprovedAt: null, leadershipDecision: null, createdAt: now(), drafts: {}, media: {} }
      set((s) => ({ ideas: applyTopRuleLocal([...s.ideas, fresh], s.settings.topPerPlatform) }))
      get().pushActivity({ agentId: 'calendar', message: `"${fresh.title.slice(0, 50)}" added to the calendar from Content Intelligence`, status: 'ok' })
      return fresh.id
    },

    approveIdea: async (id) => {
      const by = currentUserName(get)
      patchIdea(id, (x) => ({ ...x, status: 'pending_leadership', marketingApprovedBy: by, marketingApprovedAt: now() }))
      get().setAgent('review', { status: 'waiting', currentTask: `Waiting on Leadership for "${idea(id)?.title.slice(0, 40)}"` })
      get().pushActivity({ agentId: 'review', message: `${by} approved "${idea(id)?.title.slice(0, 50)}" — sent to Leadership`, status: 'ok' })
      get().toast('success', 'Sent to Leadership', 'Nothing publishes until Leadership gives the final word.')
      if (live()) { try { await api.ideas.approve(id, by) } catch (e) { get().toast('error', 'Could not record approval', String(e)) } }
    },
    leadershipApprove: async (id) => {
      const by = currentUserName(get); const i = idea(id); if (!i) return
      patchIdea(id, (x) => ({ ...x, status: 'approved', leadershipDecision: { by, decision: 'approved', at: now() } }))
      set((s) => ({ knowledge: [{ id: `k-appr-${id}`, title: `Approved: ${i.title}`, category: 'Approved Post', content: `Leadership (${by}) approved "${i.title}" on ${i.platform} for ${i.sourceTopic}. Angle and evidence pattern are safe to repeat.`, source: 'Learning Agent', sources: [], hashtagId: i.hashtagId, hashtagTag: i.hashtag, tags: ['approved', i.sourceTopic ?? ''], confidence: 'Medium', evidenceCount: 1, active: true, origin: 'learned', createdAt: now() }, ...s.knowledge] }))
      get().pushActivity({ agentId: 'review', message: `${by} gave final approval to "${i.title.slice(0, 50)}"`, status: 'ok' })
      if (live()) {
        try {
          const auto = get().settings.autoPublish
          if (auto) { set({ publishPhase: 0, publishingIdeaId: id }); for (let p = 1; p <= 3; p++) { await new Promise((r) => setTimeout(r, 850)); set({ publishPhase: p }) } }
          const r = await api.ideas.leadershipApprove(id, by, auto)
          if (auto) { set({ publishPhase: 4 }); await new Promise((res) => setTimeout(res, 850)); set({ publishPhase: -1, publishingIdeaId: null }) }
          await get().refreshState()
          if (r.published) get().toast('success', 'Published', r.published.analytics?.summary?.slice(0, 120))
          else get().toast('success', 'Approved', 'Ready to publish.')
        } catch (e) { set({ publishPhase: -1, publishingIdeaId: null }); get().toast('error', 'Could not record approval', String(e)) }
        return
      }
      get().toast('success', 'Approved', get().settings.autoPublish ? 'Publishing now…' : 'Ready to publish.')
      if (get().settings.autoPublish) setTimeout(() => { void get().publishIdea(id) }, 600)
    },
    leadershipReject: async (id, reason) => {
      if (!reason.trim()) { get().toast('error', 'A rejection needs a reason', 'It is what the agents learn from.'); return }
      const by = currentUserName(get); const i = idea(id); if (!i) return
      patchIdea(id, (x) => ({ ...x, status: 'rejected', leadershipDecision: { by, decision: 'rejected', reason: reason.trim(), at: now() } }))
      set((s) => ({ knowledge: [{ id: `k-rej-${id}`, title: `Rejected: ${i.title}`, category: 'Rejected Post', content: `Leadership (${by}) rejected "${i.title}" on ${i.platform} for ${i.sourceTopic}. Reason: ${reason.trim()}. Avoid repeating this pattern for ${i.sourceTopic}.`, source: 'Learning Agent', sources: [], hashtagId: i.hashtagId, hashtagTag: i.hashtag, tags: ['rejected', i.sourceTopic ?? ''], confidence: 'Medium', evidenceCount: 1, active: true, origin: 'learned', createdAt: now() }, ...s.knowledge], ideas: applyTopRuleLocal([...s.ideas], s.settings.topPerPlatform) }))
      get().pushActivity({ agentId: 'review', message: `${by} rejected "${i.title.slice(0, 50)}": ${reason.trim().slice(0, 80)}`, status: 'warn' })
      get().toast('info', 'Rejected', 'The reason was written to the Knowledge Base.')
      if (live()) { try { await api.ideas.leadershipReject(id, by, reason.trim()); await get().refreshState() } catch (e) { get().toast('error', 'Could not record rejection', String(e)) } }
    },
    publishIdea: async (id) => {
      const i = idea(id); if (!i) return
      if (i.status !== 'approved') { get().toast('error', 'Not approved yet', 'Nothing publishes without Marketing approval and then Leadership approval.'); return }
      if (!i.drafts[i.platform]) localDraft(id, i.platform)
      set({ publishPhase: 0, publishingIdeaId: id })
      get().setAgent('publishing', { status: 'running', currentTask: `Publishing "${i.title.slice(0, 40)}"` })
      for (let p = 1; p <= 4; p++) { await new Promise((r) => setTimeout(r, 850)); set({ publishPhase: p }) }
      if (live()) {
        try { const r = await api.ideas.publish(id); await get().refreshState(); get().toast('success', 'Published successfully', r.analytics?.summary?.slice(0, 120)) }
        catch (e) { get().toast('error', 'Publish failed', String(e)) }
      } else {
        set({ publishPhase: -1, publishingIdeaId: null })
        get().setAgent('publishing', { status: 'failed', currentTask: 'Publishing needs the agent runtime' })
        get().toast('error', 'Agent runtime not reachable', 'Publishing records a receipt through the runtime — start the API first.')
        return
      }
      get().setAgent('publishing', { status: 'completed', currentTask: 'Receipt recorded', lastRun: now() })
      set({ publishPhase: -1, publishingIdeaId: null })
    },

    addKnowledge: async (b) => {
      const local: KnowledgeEntry = { id: `k-${Date.now()}`, title: b.title, category: b.category, content: b.content, source: b.source ?? 'Manual entry', sources: [], hashtagId: null, hashtagTag: null, tags: [], confidence: 'Medium', evidenceCount: 1, active: true, origin: 'manual', createdAt: now() }
      set((s) => ({ knowledge: [local, ...s.knowledge] }))
      if (live()) { try { const k = await api.knowledge.add(b); set((s) => ({ knowledge: s.knowledge.map((x) => (x.id === local.id ? k : x)) })) } catch (e) { get().toast('error', 'Could not save entry', String(e)) } }
      get().toast('success', 'Saved to the Knowledge Base', b.title)
    },
    toggleKnowledge: async (id) => {
      const k = get().knowledge.find((x) => x.id === id); if (!k) return
      set((s) => ({ knowledge: s.knowledge.map((x) => (x.id === id ? { ...x, active: !x.active } : x)) }))
      if (live()) { try { await api.knowledge.toggle(id, !k.active) } catch (e) { get().toast('error', 'Could not update entry', String(e)) } }
    },
    pushActivity: (ev) => set((s) => ({ activity: [{ ...ev, id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: now() }, ...s.activity].slice(0, 60) })),
    setAgent: (id, patch) => set((s) => ({ agents: s.agents.some((a) => a.id === id) ? s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) : [...s.agents, { id, status: 'idle', currentTask: 'Idle', lastRun: null, processed: 0, successRate: 100, ...patch }] })),
    toast: (kind, title, body) => { const id = toastSeq++; set((s) => ({ toasts: [...s.toasts, { id, kind, title, body }] })); setTimeout(() => get().dismissToast(id), 4200) },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    updateSettings: (patch) => { set((s) => ({ settings: { ...s.settings, ...patch } })); if (patch.topPerPlatform !== undefined) { set((s) => ({ ideas: applyTopRuleLocal([...s.ideas], s.settings.topPerPlatform) })); if (live()) { void api.patchSkill('calendar.rank.select', { config: { topPerPlatform: patch.topPerPlatform } }).then(() => get().refreshState()).catch(() => undefined) } } if (patch.topKeywords !== undefined && live()) void api.patchSkill('validation.keyword.trend', { config: { topKeywords: patch.topKeywords } }).catch(() => undefined); if (patch.topHashtagsPerKeyword !== undefined && live()) void api.patchSkill('validation.hashtag.rank', { config: { topHashtagsPerKeyword: patch.topHashtagsPerKeyword } }).catch(() => undefined); if (patch.knowledgeHashtagCount !== undefined && live()) void api.patchSkill('knowledge.hashtag.select', { config: { hashtagCount: patch.knowledgeHashtagCount } }).catch(() => undefined) },
    simulateFailure: () => { set({ failedAgent: 'analysis' }); get().setAgent('analysis', { status: 'failed', currentTask: 'Failed: analysis.trend.cluster threw "cluster budget exceeded" (simulated)' }); get().pushActivity({ agentId: 'analysis', message: 'Simulated failure: analysis.trend.cluster threw "cluster budget exceeded"', status: 'error' }); get().toast('error', 'Analysis Agent failed', 'Simulated — use Retry to recover.') },
    retryFailed: async () => { const a = get().failedAgent; if (!a) return; set({ failedAgent: null }); get().setAgent(a, { status: 'running', currentTask: 'Retrying…' }); await new Promise((r) => setTimeout(r, 900)); get().setAgent(a, { status: 'completed', currentTask: `${AGENT_BY_ID[a].role} — recovered`, lastRun: now() }); get().pushActivity({ agentId: a, message: `${AGENT_BY_ID[a].name} recovered after retry`, status: 'ok' }); get().toast('success', 'Recovered', `${AGENT_BY_ID[a].name} completed on retry.`) },
    refreshAnalytics: async () => {
      get().setAgent('analytics', { status: 'running', currentTask: 'Pulling metrics' })
      if (live()) { try { const r = await api.refreshAnalytics(); await get().refreshState(); get().toast('success', 'Analytics refreshed', `${r.pulls} pulls · ${r.analysed} posts re-analysed`) } catch (e) { get().toast('error', 'Refresh failed', String(e)) } }
      else get().toast('error', 'Agent runtime not reachable', 'Metrics are pulled by the Analytics Agent inside the runtime.')
      get().setAgent('analytics', { status: 'completed', currentTask: 'Baselines refreshed', lastRun: now() })
    },
    askIntelligence: (question, month) => answerSocialQuestion(question, month, get().analytics, get().published),
    pushEvent: (e) => {
      set((s) => ({ events: [...s.events, { ...e, id: e.id ?? evSeq++ }].slice(-400) }))
      if (e.type === 'agent.started' && e.agentId) get().setAgent(e.agentId, { status: 'running', currentTask: e.message ?? 'Running' })
      if ((e.type === 'agent.finished' || e.type === 'agent.failed') && e.agentId) get().setAgent(e.agentId, { status: e.type === 'agent.failed' ? 'failed' : 'completed', currentTask: e.message ?? '', lastRun: e.at })
      if (e.type === 'activity' && e.agentId && e.message) set((s) => (s.activity[0]?.message === e.message ? {} : { activity: [{ id: `ev-${e.id}`, agentId: e.agentId as AgentId, message: e.message as string, status: ((e.data?.status as ActivityEvent['status']) ?? 'ok'), at: e.at }, ...s.activity].slice(0, 60) }))
      if (e.type === 'pipeline.finished' || e.type === 'knowledge.build.finished' || e.type === 'post.published') void get().refreshState()
    },
    clearEvents: () => set({ events: [] }),
  }
})

export const defaultKnobs = defaultSkillConfig
