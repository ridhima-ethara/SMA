import { AlertTriangle, Check, ChevronDown, Lock } from 'lucide-react'
import { useState } from 'react'
import { IMAGE_MODELS } from '../../shared/image-models'
import type { ImageModelStatus } from '../types'
import { Badge, useClickOutside } from './ui'

/** Caption writer is locked to "Ethara Writer"; image models list a licence pill and warn when they need the runtime. */
export function ModelMenu({ mode, value, onChange, models, connected }: { mode: 'caption' | 'image'; value: string; onChange: (id: string) => void; models: ImageModelStatus[]; connected: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  if (mode === 'caption') return <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-ink-2"><Lock size={12} className="text-ink-3" />Ethara Writer<Badge tone="neutral">locked</Badge></div>
  const list = IMAGE_MODELS.map((m) => { const st = models.find((x) => x.id === m.id); return { ...m, reachable: st?.reachable ?? !m.needsRuntime, reason: st?.reason ?? (m.needsRuntime ? (connected ? 'Not configured' : 'Needs the agent runtime') : 'Ready') } })
  const cur = list.find((m) => m.id === value) ?? list[0]
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-ink-2 hover:text-ink">
        <span className={`h-1.5 w-1.5 rounded-full ${cur.reachable ? 'bg-good' : 'bg-warn'}`} />{cur.label}<ChevronDown size={12} />
      </button>
      {open && (
        <div className="card absolute bottom-full left-0 z-30 mb-1 w-80 overflow-hidden py-1 shadow-xl anim-pop-in">
          {list.map((m) => (
            <button key={m.id} type="button" onClick={() => { onChange(m.id); setOpen(false) }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2">
              <span className="mt-1 w-3 text-accent">{m.id === value && <Check size={12} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm"><span className="font-medium">{m.label}</span><Badge tone="neutral">{m.licence}</Badge></span>
                <span className="mt-0.5 block text-[11px] text-ink-3 line-clamp-2">{m.description}</span>
                {!m.reachable && <span className="mt-1 flex items-center gap-1 text-[11px] text-warn"><AlertTriangle size={11} />{m.reason}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
