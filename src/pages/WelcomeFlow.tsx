import { useEffect, useState } from 'react'
import { STAGES } from '../components/layout'
import { Roundel, Wordmark } from '../components/logo'
import { PlayButton } from '../components/play-button'
import { useStore } from '../store'
import { Btn } from '../components/ui'

export function WelcomeFlow() {
  const user = useStore((s) => s.user); const agents = useStore((s) => s.agents); const closeIntro = useStore((s) => s.closeIntro); const openTheater = useStore((s) => s.openTheater); const setPage = useStore((s) => s.setPage)
  const [ready, setReady] = useState(false); const [leaving, setLeaving] = useState(false)
  useEffect(() => { const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; const t = setTimeout(() => setReady(true), reduce ? 0 : 550 + STAGES.length * 160 + 350); return () => clearTimeout(t) }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeIntro() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [closeIntro])
  const leave = (then: () => void) => { setLeaving(true); setTimeout(() => { closeIntro(); then() }, 320) }
  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = user?.name.split(' ')[0] ?? ''
  return (
    <div className={`fixed inset-0 z-[85] flex flex-col bg-page/95 backdrop-blur-xl ${leaving ? 'welcome-leave' : 'anim-fade-in'}`} role="dialog" aria-modal>
      <div className="flex items-center justify-between px-6 py-4"><div className="flex items-center gap-2"><Roundel size={28} /><Wordmark className="text-base" /></div><Btn variant="ghost" size="sm" onClick={() => leave(() => undefined)}>Skip · Esc</Btn></div>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <h2 className="display anim-fade-up text-4xl">{greet}, {first}</h2>
        <p className="anim-fade-up mt-2 text-sm text-ink-3" style={{ animationDelay: '0.15s' }}>{user?.role === 'marketing' ? 'Your eleven agents are ready. Start the pipeline and watch it work.' : 'Everything Marketing approved is waiting for your final word.'}</p>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-y-6">
          {STAGES.map((st, i) => { const Icon = st.icon; const running = agents.some((a) => st.agents.includes(a.id) && a.status === 'running'); const delay = 0.55 + i * 0.16; return (
            <div key={st.id} className="flex items-center">
              <div className="welcome-stage relative flex w-24 flex-col items-center" style={{ animationDelay: `${delay}s` }}>
                <span className="welcome-ring absolute top-0 h-14 w-14 rounded-full border border-accent" style={{ animationDelay: `${delay + 0.1}s` }} />
                <span className={`grid h-14 w-14 place-items-center rounded-full border border-line-strong bg-surface-2 text-accent ${running ? 'anim-glow' : ''}`}><Icon size={22} className={running ? 'anim-pulse-dot' : ''} /></span>
                <span className="mt-2 text-sm font-medium">{st.label}</span><span className="text-[10px] text-ink-3">{st.agents.length} agent{st.agents.length > 1 ? 's' : ''}</span>
              </div>
              {i < STAGES.length - 1 && <div className="relative -mt-9 h-px w-10 bg-line-strong"><span className="flowbar-connector absolute inset-0 bg-accent/60" style={{ animationDelay: `${delay + 0.25}s` }} /><span className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-magenta welcome-spark" style={{ animationDelay: `${delay + 0.3}s`, offsetPath: 'path("M0 0 L 40 0")' }} /></div>}
            </div>
          ) })}
        </div>
        <div className={`mt-14 flex flex-col items-center gap-3 transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}>
          {user?.role === 'marketing'
            ? <PlayButton size="lg" label="Start scraping" hint="Scraping → Validation → Calendar" onClick={() => leave(() => openTheater())} />
            : <Btn variant="primary" size="lg" onClick={() => leave(() => setPage('leadership'))}>Open final approvals</Btn>}
          <button type="button" onClick={() => leave(() => undefined)} className="text-xs text-ink-3 hover:text-ink">Go to the dashboard</button>
        </div>
      </div>
    </div>
  )
}
