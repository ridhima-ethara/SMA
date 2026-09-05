import { Brain } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { SlideOver } from '../components/ui'
import { useStore } from '../store'
import { KnowledgeBase } from './KnowledgeBase'

export function KnowledgeDrawer() {
  const { open, close, knowledge } = useStore(useShallow((s) => ({ open: s.knowledgeOpen, close: s.closeKnowledge, knowledge: s.knowledge })))
  const active = knowledge.filter((k) => k.active).length; const cats = new Set(knowledge.map((k) => k.category)).size; const high = knowledge.filter((k) => k.confidence === 'High').length
  return (
    <SlideOver open={open} onClose={close} title="Knowledge Base" subtitle={`${knowledge.length} entries · ${active} active · ${cats} categories · ${high} high-confidence`} icon={<span className="relative grid h-9 w-9 place-items-center rounded-full bg-accent/20 text-accent"><span className="absolute inset-0 rounded-full border border-accent anim-ping-slow" /><Brain size={17} /></span>}>
      <div className="px-6 py-5"><p className="mb-5 max-w-3xl text-sm text-ink-2">Everything the platform has learned lives here. Every agent reads from this before it acts, and every outcome is written back. Switch an entry off to stop it influencing the next draft.</p><KnowledgeBase embedded /></div>
    </SlideOver>
  )
}
