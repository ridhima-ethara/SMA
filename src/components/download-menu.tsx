import { ChevronDown, Download } from 'lucide-react'
import { useState } from 'react'
import { useClickOutside } from './ui'

export function DownloadMenu({ items, compact = false, label = 'Download' }: { items: Array<{ label: string; onClick: () => void }>; compact?: boolean; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(() => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} title={label} aria-label={label} className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 text-ink-2 transition-colors hover:text-ink ${compact ? 'h-7 px-2 text-xs' : 'h-9 px-3 text-sm'}`}>
        <Download size={compact ? 12 : 14} />{!compact && <>{label}<ChevronDown size={13} /></>}
      </button>
      {open && (
        <div className="card absolute right-0 z-30 mt-1 min-w-[190px] overflow-hidden py-1 shadow-xl anim-pop-in" onClick={(e) => e.stopPropagation()}>
          {items.map((it) => <button key={it.label} type="button" onClick={() => { it.onClick(); setOpen(false) }} className="block w-full px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">{it.label}</button>)}
        </div>
      )}
    </div>
  )
}
