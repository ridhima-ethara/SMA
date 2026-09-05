import { Activity, Bell, Brain, Calendar, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Radar, Send, Settings, ShieldCheck, Sparkles, SlidersHorizontal, Terminal, Wand2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AGENT_BY_ID, type AgentId } from '../../shared/agent-registry'
import { AGENT_STATUS_META, useStore } from '../store'
import type { Page } from '../types'
import { Roundel, Wordmark } from './logo'
import { ThemeToggle } from './theme-toggle'
import { Badge, ToastHost } from './ui'

export const STAGES: Array<{ id: string; label: string; agents: AgentId[]; icon: typeof Radar }> = [
  { id: 'scrape', label: 'Scrape', agents: ['scraping'], icon: Radar }, { id: 'validate', label: 'Validate', agents: ['validation'], icon: ShieldCheck }, { id: 'analyze', label: 'Analyze', agents: ['analysis'], icon: Activity },
  { id: 'ideas', label: 'Ideas', agents: ['calendar'], icon: Calendar }, { id: 'create', label: 'Create', agents: ['caption', 'image', 'review'], icon: Wand2 }, { id: 'publish', label: 'Publish', agents: ['publishing'], icon: Send },
  { id: 'measure', label: 'Measure', agents: ['analytics'], icon: LayoutDashboard }, { id: 'learn', label: 'Learn', agents: ['knowledge', 'learning'], icon: Brain },
]

export function LiveBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-page">
      <div className="absolute inset-0 bg-live" />
      <div className="live-orb live-orb-a left-[-10%] top-[-10%] h-[42vw] w-[42vw] bg-accent/25" />
      <div className="live-orb live-orb-b right-[-8%] top-[20%] h-[36vw] w-[36vw] bg-magenta/18" />
      <div className="live-orb live-orb-c bottom-[-14%] left-[30%] h-[34vw] w-[34vw] bg-accent/16" />
      <div className="live-grid absolute inset-0" />
    </div>
  )
}

const NAV: Array<{ page: Page; label: string; icon: typeof Radar; roles: Array<'marketing' | 'leadership'> }> = [
  { page: 'leadership', label: 'Final Approval', icon: ShieldCheck, roles: ['leadership'] },
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['marketing', 'leadership'] },
  { page: 'calendar', label: 'Weekly Calendar', icon: Calendar, roles: ['marketing'] },
  { page: 'published', label: 'Published Posts', icon: Send, roles: ['marketing', 'leadership'] },
  { page: 'activity', label: 'Agent Activity', icon: Activity, roles: ['marketing', 'leadership'] },
  { page: 'intelligence', label: 'Content Intelligence', icon: Radar, roles: ['marketing'] },
  { page: 'studio', label: 'Agent Studio', icon: SlidersHorizontal, roles: ['marketing'] },
  { page: 'console', label: 'Run Console', icon: Terminal, roles: ['marketing'] },
  { page: 'settings', label: 'Settings', icon: Settings, roles: ['marketing'] },
]

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { page, setPage, user, agents, ideas, reviewQueue, publishMode, apiMode } = useStore(useShallow((s) => ({ page: s.page, setPage: s.setPage, user: s.user, agents: s.agents, ideas: s.ideas, reviewQueue: s.reviewQueue, publishMode: s.publishMode, apiMode: s.apiMode })))
  const pending = ideas.filter((i) => i.status === 'pending_leadership').length
  const running = agents.some((a) => a.status === 'running'); const needs = agents.some((a) => a.status === 'needs_review' || a.status === 'failed') || reviewQueue.length > 0
  const health = running ? { cls: 'bg-accent anim-pulse-dot', text: 'Agents running' } : needs ? { cls: 'bg-serious', text: `${reviewQueue.length || 1} item(s) need review` } : { cls: 'bg-good', text: 'All agents healthy' }
  return (
    <aside className="glass flex h-full shrink-0 flex-col border-r border-line transition-[width] duration-300" style={{ width: collapsed ? 64 : 236 }}>
      <div className="flex items-center gap-2.5 px-4 py-4"><Roundel size={30} />{!collapsed && <div className="min-w-0 leading-tight"><Wordmark className="text-base" /><div className="text-[10px] text-ink-3">Social Media Agent</div></div>}</div>
      {!collapsed && <div className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-xs"><span className="truncate">Ethara.AI · Main</span><Badge tone={apiMode === 'live' ? (publishMode === 'live' ? 'good' : 'magenta') : 'warn'}>{apiMode === 'live' ? publishMode.toUpperCase() : 'OFFLINE'}</Badge></div>}
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.filter((n) => user && n.roles.includes(user.role)).map((n) => { const active = page === n.page; const Icon = n.icon; return (
          <button key={n.page} type="button" onClick={() => setPage(n.page)} title={n.label} className={`relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${active ? 'bg-gradient-to-r from-accent/20 to-magenta/10 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
            {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />}
            <Icon size={17} className={active ? 'text-accent' : ''} />{!collapsed && <span className="truncate">{n.label}</span>}
            {n.page === 'leadership' && pending > 0 && <span className={`tabular grid h-5 min-w-5 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white ${collapsed ? 'absolute -right-0.5 -top-0.5' : 'ml-auto'}`}>{pending}</span>}
          </button>
        ) })}
      </nav>
      <div className="border-t border-line p-3"><div className="flex items-center gap-2 text-xs text-ink-2"><span className={`h-2 w-2 shrink-0 rounded-full ${health.cls}`} />{!collapsed && <span className="flex-1 truncate">{health.text}</span>}<button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Collapse sidebar">{collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}</button></div></div>
    </aside>
  )
}

function Header() {
  const { user, logout, setPage, openKnowledge, knowledge, ideas, reviewQueue, agents, publishMode, apiMode } = useStore(useShallow((s) => ({ user: s.user, logout: s.logout, setPage: s.setPage, openKnowledge: s.openKnowledge, knowledge: s.knowledge, ideas: s.ideas, reviewQueue: s.reviewQueue, agents: s.agents, publishMode: s.publishMode, apiMode: s.apiMode })))
  const attention = user?.role === 'leadership' ? ideas.some((i) => i.status === 'pending_leadership') : reviewQueue.length > 0 || agents.some((a) => a.status === 'failed' || a.status === 'needs_review')
  return (
    <header className="glass flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4">
      <ThemeToggle />
      <Badge tone={apiMode === 'live' ? (publishMode === 'live' ? 'good' : 'magenta') : 'warn'} className="hidden sm:inline-flex" title={apiMode === 'live' ? `Publishing mode: ${publishMode}` : 'Agent runtime not reachable'}>{apiMode === 'live' ? `${publishMode.toUpperCase()} MODE` : 'RUNTIME OFFLINE'}</Badge>
      <button type="button" onClick={openKnowledge} className="relative inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface-2 pl-1 pr-3 text-xs text-ink-2 hover:text-ink" title="Knowledge Base">
        <span className="relative grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-accent"><span className="absolute inset-0 rounded-full border border-accent anim-ping-slow" /><Brain size={13} /></span>
        <span className="hidden lg:inline">Knowledge Base</span><span className="tabular rounded-full bg-accent px-1.5 text-[10px] font-semibold text-on-accent">{knowledge.filter((k) => k.active).length}</span>
      </button>
      <button type="button" onClick={() => setPage(user?.role === 'leadership' ? 'leadership' : 'activity')} className="relative grid h-8 w-8 place-items-center rounded-full border border-line bg-surface-2 text-ink-2 hover:text-ink" aria-label="Notifications"><Bell size={15} />{attention && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-critical" />}</button>
      {user && <div className="ml-1 flex items-center gap-2 border-l border-line pl-3"><div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-magenta text-sm font-semibold text-white">{user.initial}</div><div className="hidden leading-tight md:block"><div className="text-sm font-medium">{user.name}</div><div className="text-[10px] text-ink-3">{user.title}</div></div><button type="button" onClick={logout} className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" title="Sign out" aria-label="Sign out"><LogOut size={15} /></button></div>}
    </header>
  )
}

export function AgentChips({ agents }: { agents: AgentId[] }) {
  const { states, setPage } = useStore(useShallow((s) => ({ states: s.agents, setPage: s.setPage })))
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3"><Sparkles size={12} className="text-magenta-ink" />Powered by
      {agents.map((id) => { const st = states.find((a) => a.id === id); const meta = AGENT_STATUS_META[st?.status ?? 'idle']; return <button key={id} type="button" onClick={() => setPage('activity')} title={`${AGENT_BY_ID[id].name} · ${meta.label}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-ink-2 hover:text-ink"><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{AGENT_BY_ID[id].shortName}</button> })}
    </div>
  )
}

export function PageHeader({ title, subtitle, agents, actions }: { title: string; subtitle?: string; agents?: AgentId[]; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4 anim-fade-up">
      <div><h1 className="display text-3xl">{title}</h1>{subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-3">{subtitle}</p>}{agents && <div className="mt-2"><AgentChips agents={agents} /></div>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { toasts, dismissToast } = useStore(useShallow((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast })))
  return (
    <div className="flex h-screen overflow-hidden">
      <LiveBackground />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col"><Header /><main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">{children}</main></div>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
