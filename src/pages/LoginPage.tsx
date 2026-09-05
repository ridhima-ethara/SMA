import { Eye, EyeOff, Megaphone, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../store'
import type { Role } from '../types'
import { USERS } from '../data/initial'
import { Logo, Roundel, Wordmark } from '../components/logo'
import { ThemeToggle } from '../components/theme-toggle'

function Backdrop({ variant }: { variant: 'brand' | 'form' }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className={`auth-glow absolute h-[60%] w-[60%] rounded-full blur-3xl ${variant === 'brand' ? 'left-[-10%] top-[-10%] bg-accent/25' : 'right-[-15%] bottom-[-10%] bg-magenta/15'}`} />
      <div className="auth-grid absolute inset-0" />
      <div className="auth-signal top-[30%]" style={{ animationDelay: '0s' }} /><div className="auth-signal top-[62%]" style={{ animationDelay: '2.5s' }} /><div className="auth-signal top-[80%]" style={{ animationDelay: '5s' }} />
      <div className="auth-sweep" />
      {[8, 22, 37, 51, 64, 78, 91].map((l, i) => <span key={i} className="auth-particle" style={{ left: `${l}%`, animationDelay: `${i * 1.3}s`, opacity: 0 }} />)}
    </div>
  )
}

export function LoginPage() {
  const login = useStore((s) => s.login)
  const [role, setRole] = useState<Role>('marketing')
  const [password, setPassword] = useState('ethara-demo')
  const [show, setShow] = useState(false)
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const user = USERS[role]
  const submit = (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setTimeout(() => { setBusy(false); login(role) }, 700) }
  const roles: Array<{ id: Role; icon: typeof Megaphone; title: string; who: string; body: string }> = [
    { id: 'marketing', icon: Megaphone, title: 'Marketing team', who: 'Ridhima · Marketing Lead', body: 'Runs the agents end to end and gives first approval' },
    { id: 'leadership', icon: ShieldCheck, title: 'Leadership', who: 'Arjun Mehta · CMO', body: 'Final approval on every post before it is published' },
  ]
  return (
    <div className="relative grid min-h-screen grid-cols-1 lg:grid-cols-2 bg-page">
      <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-line p-12">
        <Backdrop variant="brand" />
        <div className="relative auth-reveal inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-ink-3" style={{ animationDelay: '0.3s' }}><Sparkles size={13} className="text-magenta-ink" /> Social media agent</div>
        <div className="relative">
          <div className="relative mx-auto mb-10 grid h-[260px] w-[260px] place-items-center">
            <div className="auth-halo absolute inset-6 rounded-full bg-magenta/15 blur-2xl" />
            <div className="auth-orbit auth-orbit-spin absolute inset-0 rounded-full border border-dashed border-accent/40" /><div className="auth-orbit auth-orbit-spin-reverse absolute inset-8 rounded-full border border-line-strong" style={{ animationDelay: '0.2s' }} />
            <div className="auth-mark-float text-ink"><Logo size={150} animated /></div>
          </div>
          <Wordmark animated className="block text-5xl leading-none" />
          <div className="auth-reveal mt-3 text-sm uppercase tracking-[0.18em] text-accent" style={{ animationDelay: '1.9s' }}>Eleven agents · one pipeline</div>
          <p className="auth-reveal mt-5 max-w-md text-base leading-relaxed text-ink-2" style={{ animationDelay: '2.1s' }}>The agents discover, plan and write. Marketing shapes and approves. Leadership gives the final word. Every decision is remembered, so the next post is better than the last.</p>
          <div className="auth-reveal mt-6 flex flex-wrap gap-2" style={{ animationDelay: '2.3s' }}>{['Role controlled', 'Two-stage approval', 'Knowledge base'].map((t) => <span key={t} className="rounded-full border border-line bg-surface-2/70 px-3 py-1 text-xs text-ink-2">{t}</span>)}</div>
        </div>
        <div className="relative auth-reveal text-xs text-ink-3" style={{ animationDelay: '2.5s' }}>Ethara social media agent · marketing operations</div>
      </section>
      <section className="relative flex items-center justify-center overflow-hidden p-6 sm:p-12">
        <Backdrop variant="form" />
        <form onSubmit={submit} className="auth-card card relative w-full max-w-md p-7 glass" style={{ animationDelay: '0.5s' }}>
          <div className="mb-5 flex items-center gap-2 lg:hidden"><Roundel size={30} /><Wordmark className="text-lg" /></div>
          <div className="auth-field text-[11px] uppercase tracking-[0.18em] text-accent" style={{ animationDelay: '0.8s' }}>Welcome back</div>
          <h1 className="display auth-field mt-1 text-3xl" style={{ animationDelay: '0.9s' }}>Sign in</h1>
          <p className="auth-field mt-1 text-sm text-ink-3" style={{ animationDelay: '1s' }}>Access the agents, calendar, approvals and analytics.</p>
          <label className="auth-field mt-5 block text-xs text-ink-2" style={{ animationDelay: '1.1s' }}>Email<input readOnly value={user.email} className="mt-1 w-full opacity-80" /></label>
          <div role="radiogroup" aria-label="Role" className="auth-field mt-4 grid gap-2" style={{ animationDelay: '1.25s' }}>
            {roles.map((r) => { const Icon = r.icon; const on = role === r.id; return (
              <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => setRole(r.id)} className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${on ? 'border-accent bg-accent/10 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]' : 'border-line bg-surface-2 hover:border-line-strong'}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? 'bg-accent text-on-accent' : 'bg-surface-3 text-ink-2'}`}><Icon size={17} /></span>
                <span><span className="block text-sm font-semibold">{r.title}</span><span className="block text-xs text-ink-2">{r.who}</span><span className="block text-[11px] text-ink-3">{r.body}</span></span>
              </button>
            ) })}
          </div>
          <label className="auth-field mt-4 block text-xs text-ink-2" style={{ animationDelay: '1.4s' }}>Password<span className="relative mt-1 block"><input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full pr-9" /><button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink" aria-label="Show password">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
          <label className="auth-field mt-3 flex items-center gap-2 text-xs text-ink-2" style={{ animationDelay: '1.5s' }}><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-3.5 w-3.5 p-0" />Keep me signed in</label>
          <button type="submit" disabled={busy} className="auth-field mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent to-magenta text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-70" style={{ animationDelay: '1.6s' }}>{busy ? <span className="auth-spinner h-4 w-4 rounded-full border-2 border-white/40 border-t-white" /> : `Sign in as ${user.name.split(' ')[0]}`}</button>
          <div className="auth-field my-4 flex items-center gap-3 text-[11px] text-ink-3" style={{ animationDelay: '1.7s' }}><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <button type="button" className="auth-field h-10 w-full rounded-lg border border-line text-sm text-ink-2" style={{ animationDelay: '1.8s' }} onClick={() => undefined}>Request access</button>
          <p className="auth-field mt-4 text-center text-[11px] text-ink-3" style={{ animationDelay: '1.9s' }}>Workspace access is role-based — roles control which screens and approvals you see.</p>
        </form>
      </section>
    </div>
  )
}
