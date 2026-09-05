import { Inbox, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IdeaStatus, Platform, Toast } from '../types'

// ── Brand glyphs (lucide dropped brand icons) ───────────────────────────
export function LinkedinGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.26 2.37 4.26 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" /></svg>
}
export function InstagramGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d="M12 2.16c3.2 0 3.58.01 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.64.07-4.85.07s-3.58-.01-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 2.7.27.27 2.7.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95C23.73 2.7 21.3.27 16.95.07 15.67.01 15.26 0 12 0zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" /></svg>
}
export function XGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden><path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z" /></svg>
}

export const PLATFORM_LABEL: Record<Platform, string> = { linkedin: 'LinkedIn', instagram: 'Instagram', x: 'X' }
export const PLATFORM_COLOR: Record<Platform, string> = { linkedin: 'var(--color-series-li)', instagram: 'var(--color-series-ig)', x: 'var(--color-series-x)' }
export function PlatformIcon({ platform, size = 14, className = '' }: { platform: Platform; size?: number; className?: string }) {
  if (platform === 'linkedin') return <LinkedinGlyph size={size} className={className} />
  if (platform === 'instagram') return <InstagramGlyph size={size} className={className} />
  return <XGlyph size={size} className={className} />
}
export function PlatformChip({ platform, size = 'sm' }: { platform: Platform; size?: 'sm' | 'md' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 font-medium text-ink-2 ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}>
      <span style={{ color: PLATFORM_COLOR[platform] }}><PlatformIcon platform={platform} size={size === 'sm' ? 11 : 13} /></span>
      {PLATFORM_LABEL[platform]}
    </span>
  )
}

// ── Formatting ──────────────────────────────────────────────────────────
export function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(Math.round(n))
}
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000)
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`
  return `in ${Math.floor(s / 86400)}d`
}
export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  if (!d) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d)
  return date.toLocaleDateString('en-US', opts)
}

// ── Primitives ──────────────────────────────────────────────────────────
export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical' | 'magenta'
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  accent: 'bg-accent/15 text-accent-bright border-accent/30',
  good: 'bg-good/15 text-good-ink border-good/30',
  warn: 'bg-warn/15 text-warn border-warn/30',
  serious: 'bg-serious/15 text-serious border-serious/30',
  critical: 'bg-critical/15 text-critical-ink border-critical/30',
  magenta: 'bg-magenta/15 text-magenta-ink border-magenta/30',
}
export function Badge({ tone = 'neutral', children, className = '', dot = false, title }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${TONE[tone]} ${className}`}>{dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}</span>
}

type BtnVariant = 'primary' | 'ghost' | 'subtle' | 'danger'
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-bright shadow-[0_6px_18px_-8px_var(--color-glow)]',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border border-line',
  subtle: 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-critical/15 text-critical-ink border border-critical/30 hover:bg-critical/25',
}
export function Btn({ variant = 'subtle', size = 'md', children, className = '', icon, ...rest }: { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; children?: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sz = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : size === 'lg' ? 'h-11 px-5 text-sm gap-2' : 'h-9 px-3.5 text-sm gap-2'
  return <button type="button" {...rest} className={`inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none ${BTN[variant]} ${sz} ${className}`}>{icon}{children}</button>
}

export function useCountUp(target: number, duration = 900): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setV(target); return }
    let raf = 0
    const start = performance.now()
    const tick = (t: number) => { const p = Math.min(1, (t - start) / duration); setV(target * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return v
}

export function KpiCard({ label, value, delta, hint, icon, format = fmt, suffix = '', tone, i = 0 }: { label: string; value: number; delta?: number | null; hint?: string; icon?: ReactNode; format?: (n: number) => string; suffix?: string; tone?: Tone; i?: number }) {
  const v = useCountUp(value)
  return (
    <div className="card card-hover p-4 min-w-0" style={{ ['--i' as string]: i }}>
      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-ink-3">{label}{icon && <span className="text-accent">{icon}</span>}</div>
      <div className={`display tabular mt-1.5 text-2xl ${tone === 'serious' ? 'text-serious' : tone === 'good' ? 'text-good-ink' : ''}`}>{format(v)}{suffix}</div>
      {(delta != null || hint) && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
          {delta != null && <span className={`tabular font-medium ${delta >= 0 ? 'text-good-ink' : 'text-critical-ink'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</span>}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  )
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}><div className="h-full rounded-full bg-gradient-to-r from-accent to-magenta transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface-2 p-1">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${value === t.id ? 'bg-accent text-on-accent' : 'text-ink-2 hover:text-ink'}`}>
          {t.label}{t.count != null && <span className={`tabular rounded-full px-1.5 text-[10px] ${value === t.id ? 'bg-on-accent/20' : 'bg-surface-3'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [open, onClose])
}

export function Modal({ open, onClose, title, children, wide = false, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-page/70 p-4 backdrop-blur-sm anim-fade-in" onMouseDown={onClose} role="dialog" aria-modal>
      <div className={`card w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-hidden flex flex-col anim-dialog shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3"><div className="display text-base">{title}</div><button type="button" onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close"><X size={16} /></button></div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function SlideOver({ open, onClose, title, subtitle, children, icon }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; icon?: ReactNode }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] bg-page/60 backdrop-blur-sm anim-fade-in" onMouseDown={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-6xl bg-surface border-l border-line shadow-2xl anim-slide-in flex flex-col" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">{icon}<div><div className="display text-lg">{title}</div>{subtitle && <div className="text-xs text-ink-3">{subtitle}</div>}</div></div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}

/** Centred full workspace — the review panel is a dialog, not a drawer. */
export function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEsc(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-page/75 p-3 backdrop-blur-md anim-fade-in" onMouseDown={onClose} role="dialog" aria-modal>
      <div className="card h-[94vh] w-full max-w-[1480px] overflow-hidden flex flex-col anim-dialog shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card grid place-items-center px-6 py-12 text-center anim-fade-up">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-ink-3">{icon ?? <Inbox size={22} />}</div>
      <div className="display text-base">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-ink-3">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ToastHost({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto card anim-slide-in border-l-4 px-3.5 py-3 shadow-xl ${t.kind === 'success' ? 'border-l-good' : t.kind === 'error' ? 'border-l-critical' : 'border-l-accent'}`}>
          <div className="flex items-start justify-between gap-2"><div><div className="text-sm font-medium">{t.title}</div>{t.body && <div className="mt-0.5 text-xs text-ink-3">{t.body}</div>}</div><button type="button" onClick={() => onDismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss"><X size={14} /></button></div>
        </div>
      ))}
    </div>
  )
}

export function ScoreRing({ value, size = 56, stroke = 5, label, tone }: { value: number; size?: number; stroke?: number; label?: string; tone?: 'auto' | 'accent' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = tone === 'accent' ? 'var(--color-accent)' : value >= 75 ? 'var(--color-good)' : value >= 50 ? 'var(--color-warn)' : 'var(--color-serious)'
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-surface-3)" strokeWidth={stroke} fill="none" /><circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)' }} /></svg>
      <div className="absolute text-center leading-none"><div className="tabular font-semibold" style={{ fontSize: size * 0.27 }}>{Math.round(value)}</div>{label && <div className="mt-0.5 text-[9px] uppercase tracking-wide text-ink-3">{label}</div>}</div>
    </div>
  )
}

export function Switch({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-surface-3'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <span className={`inline-block rounded-full border-2 border-line-strong border-t-accent anim-spin ${className}`} style={{ width: size, height: size }} aria-label="Loading" />
}

export const IDEA_STATUS_META: Record<IdeaStatus, { label: string; tone: Tone }> = {
  suggested: { label: 'Suggested', tone: 'neutral' },
  drafted: { label: 'Draft ready', tone: 'accent' },
  in_review: { label: 'In review', tone: 'accent' },
  pending_leadership: { label: 'With Leadership', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  scheduled: { label: 'Scheduled', tone: 'good' },
  published: { label: 'Published', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
}
export const VALIDATION_META: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' }, validated: { label: 'Validated', tone: 'good' }, needs_review: { label: 'Needs review', tone: 'serious' }, duplicate: { label: 'Duplicate', tone: 'warn' }, rejected: { label: 'Rejected', tone: 'critical' },
}

export function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside() }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [onOutside])
  return ref
}
