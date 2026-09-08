import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BRAND, deriveHashtags } from '../../shared/brand-voice'
import { PageHeader } from '../components/layout'
import { Badge, Btn, PlatformIcon, Switch } from '../components/ui'
import { useStore } from '../store'

export function SettingsPage() {
  const { settings, updateSettings, keywords, addKeyword, updateKeyword, removeKeyword, integrations, apiMode, toast, publishMode } = useStore(useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings, keywords: s.keywords, addKeyword: s.addKeyword, updateKeyword: s.updateKeyword, removeKeyword: s.removeKeyword, integrations: s.integrations, apiMode: s.apiMode, toast: s.toast, publishMode: s.publishMode })))
  const [term, setTerm] = useState(''); const [cat, setCat] = useState('Core'); const [weight, setWeight] = useState(60); const [sample, setSample] = useState('reward modeling for agentic post-training')
  const connect = (name: string) => toast('info', `${name}: publishing runs in ${publishMode} mode`, 'Set PUBLISH_MODE=live and the platform credentials in server/.env to dispatch for real; the two modes are never mixed on a receipt.')
  const services = [
    { name: 'Apify · LinkedIn scraping', st: integrations.apify, env: 'APIFY_API_TOKEN' }, { name: 'Parallel Web Systems · research', st: integrations.parallel, env: 'PARALLEL_API_KEY' },
    { name: 'Google Cloud · Gemini captions', st: integrations.gcp, env: 'GCP_API_KEY (or GCP_SERVICE_ACCOUNT_JSON)' }, { name: 'Gemini 2.5 Flash Image · painted backgrounds', st: integrations.gcp, env: 'GCP_IMAGE_MODEL=gemini-2.5-flash-image' },
    { name: 'Platform publishing', st: { configured: publishMode === 'live', reason: publishMode === 'live' ? 'Live dispatch' : 'PUBLISH_MODE=demo — receipts are recorded without dispatching' }, env: 'PUBLISH_MODE=live + platform credentials' },
  ]
  const knobs: Array<{ key: 'topKeywords' | 'topHashtagsPerKeyword' | 'knowledgeHashtagCount' | 'topPerPlatform'; label: string; help: string; min: number; max: number }> = [
    { key: 'topKeywords', label: 'Top keywords', help: 'How many keywords the Validation Agent marks trending each run (validation.keyword.trend).', min: 1, max: 20 },
    { key: 'topHashtagsPerKeyword', label: 'Top hashtags per keyword', help: 'Hashtags kept and ranked for each trending keyword (validation.hashtag.rank).', min: 1, max: 20 },
    { key: 'knowledgeHashtagCount', label: 'Knowledge Base hashtags', help: 'How many top hashtags the Knowledge Agent researches every Sunday (knowledge.hashtag.select).', min: 1, max: 100 },
    { key: 'topPerPlatform', label: 'Calendar posts per platform', help: 'Ideas per platform that take a calendar slot; the rest go to More suggestions (calendar.rank.select).', min: 1, max: 30 },
  ]
  return (
    <div>
      <PageHeader title="Settings" subtitle="Platforms, keywords, brand and the pipeline size knobs — every value here is a declared skill setting, mirrored in Agent Studio." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="card p-5 anim-fade-up"><h3 className="display text-base">Social Platforms</h3><p className="text-xs text-ink-3">Publishing mode is <b>{publishMode}</b>. Every receipt is stamped with the mode it was dispatched in; the two are never mixed.</p>
          <div className="mt-3 space-y-2">{(['linkedin', 'instagram', 'x'] as const).map((p) => <div key={p} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5"><div className="flex items-center gap-2 text-sm"><PlatformIcon platform={p} size={16} />{p === 'x' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1)}<Badge tone={publishMode === 'live' ? 'good' : 'neutral'}>{publishMode === 'live' ? 'Connected' : 'Not connected'}</Badge></div><Btn size="sm" variant="ghost" onClick={() => connect(p)}>Connect</Btn></div>)}</div>
        </section>
        <section className="card p-5 anim-fade-up" style={{ animationDelay: '60ms' }}><h3 className="display text-base">Keywords &amp; Sources</h3><p className="text-xs text-ink-3">The seeded keyword set drives every scrape. Weight sorts the run; the top {12} active keywords are scraped.</p>
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line"><table className="w-full text-xs"><thead className="sticky top-0 bg-surface-2 text-[10px] uppercase text-ink-3"><tr><th className="px-2 py-1.5 text-left">Term</th><th className="px-2 py-1.5 text-left">Category</th><th className="px-2 py-1.5 text-left">Weight</th><th className="px-2 py-1.5">Active</th><th /></tr></thead><tbody>{keywords.map((k) => <tr key={k.id} className="border-t border-line/60"><td className="px-2 py-1.5 font-medium">{k.term}</td><td className="px-2 py-1.5"><select value={k.category} onChange={(e) => updateKeyword(k.id, { category: e.target.value })} className="py-0.5 text-xs">{['Core', 'Adjacent', 'Positioning'].map((c) => <option key={c}>{c}</option>)}</select></td><td className="px-2 py-1.5"><input type="number" min={0} max={100} value={k.weight} onChange={(e) => updateKeyword(k.id, { weight: Number(e.target.value) })} className="w-16 py-0.5 text-xs" /></td><td className="px-2 py-1.5 text-center"><Switch checked={k.active} onChange={(v) => updateKeyword(k.id, { active: v })} /></td><td className="px-2 py-1.5"><button type="button" onClick={() => removeKeyword(k.id)} className="text-ink-3 hover:text-critical-ink">Deactivate</button></td></tr>)}</tbody></table></div>
          <div className="mt-2 flex gap-2"><input placeholder="Add keyword…" value={term} onChange={(e) => setTerm(e.target.value)} className="flex-1 text-xs" /><select value={cat} onChange={(e) => setCat(e.target.value)} className="text-xs">{['Core', 'Adjacent', 'Positioning'].map((c) => <option key={c}>{c}</option>)}</select><input type="number" value={weight} min={0} max={100} onChange={(e) => setWeight(Number(e.target.value))} className="w-16 text-xs" /><Btn size="sm" variant="primary" icon={<Plus size={13} />} disabled={term.trim().length < 2} onClick={() => { void addKeyword({ term: term.trim(), category: cat, weight }); setTerm('') }}>Add</Btn></div>
          <div className="mt-4 grid gap-2 text-xs">
            <div className="flex items-center justify-between"><span className="text-ink-3">Apify status</span><Badge tone={integrations.apify.configured ? 'good' : 'warn'}>{integrations.apify.configured ? 'Configured' : `Not configured — ${integrations.apify.reason.split(' — ')[0]}`}</Badge></div>
            {[['Posts actor', 'apimaestro~linkedin-posts-search-scraper-no-cookies'], ['Hashtag actor', 'apimaestro~linkedin-hashtag-posts-scraper'], ['Profile actor', 'apimaestro~linkedin-profile-posts-scraper']].map(([l, v]) => <label key={l} className="grid grid-cols-[110px_1fr] items-center gap-2 text-ink-3">{l}<input readOnly value={v} className="mono text-[11px] opacity-80" /></label>)}
            <div className="flex flex-wrap gap-2 pt-1">{[['Max keywords per run', 12], ['Max items per keyword', 50], ['Run timeout', '180 s'], ['Actor memory', '1024 MB']].map(([l, v]) => <span key={String(l)} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">{l}: <b>{v}</b></span>)}</div>
          </div>
        </section>
        <section className="card p-5 anim-fade-up" style={{ animationDelay: '120ms' }}><h3 className="display text-base">Brand Settings</h3><p className="text-xs text-ink-3">Read live from shared/brand-voice.ts — this is exactly what the agents enforce.</p>
          <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">{BRAND.positioning}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]"><Badge tone="accent">Emoji budget: {BRAND.emojiBudget}</Badge><Badge tone="accent">Hashtags: {BRAND.hashtags.min}–{BRAND.hashtags.max}</Badge><Badge tone="accent">Hook ≤ {BRAND.hookMaxWords} words</Badge></div>
          <label className="mt-3 block text-xs text-ink-2">Voice<input value={settings.tone} onChange={(e) => updateSettings({ tone: e.target.value })} className="mt-1 w-full" /></label>
          <label className="mt-2 block text-xs text-ink-2">Audience<textarea rows={2} value={settings.audience} onChange={(e) => updateSettings({ audience: e.target.value })} className="mt-1 w-full" /></label>
          <label className="mt-2 block text-xs text-ink-2">Try hashtag derivation<input value={sample} onChange={(e) => setSample(e.target.value)} className="mt-1 w-full" /></label>
          <div className="mt-2 flex flex-wrap gap-1.5">{deriveHashtags(sample, 5).map((t) => <Badge key={t} tone="magenta">#{t}</Badge>)}</div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-2"><span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded" style={{ background: BRAND.visual.accent }} />{BRAND.visual.accent}</span><span>Display: {BRAND.visual.displayFont}</span><span>Body: {BRAND.visual.bodyFont}</span></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{['LinkedIn · 3/week', 'Instagram · 2/week', 'X · 3/week'].map((f) => <Badge key={f}>{f}</Badge>)}</div>
        </section>
        <section className="card p-5 anim-fade-up" style={{ animationDelay: '180ms' }}><h3 className="display text-base">AI Settings</h3>
          <label className="mt-3 block text-xs text-ink-2">Creativity · <b>{settings.creativity}%</b><input type="range" min={0} max={100} value={settings.creativity} onChange={(e) => updateSettings({ creativity: Number(e.target.value) })} className="mt-1 w-full" /><span className="text-[11px] text-ink-3">Maps to the Gemini temperature (generation.caption.explanation). Brand voice enforcement always runs last, whatever the setting.</span></label>
          <div className="mt-4 space-y-3">{knobs.map((k) => <div key={k.key} className="rounded-lg border border-line bg-surface-2 p-3"><div className="flex items-center justify-between text-sm"><span className="font-medium">{k.label}</span><input type="number" min={k.min} max={k.max} value={settings[k.key]} onChange={(e) => updateSettings({ [k.key]: Math.max(k.min, Math.min(k.max, Number(e.target.value))) })} className="w-20 py-1 text-right text-sm tabular" /></div><div className="mt-1 text-[11px] text-ink-3">{k.help}</div></div>)}</div>
          <div className="mt-4 space-y-2 text-sm">{[['approvalRequired', 'Human approval required', 'Two approvals before anything publishes. This one cannot be removed.'], ['autoPublish', 'Auto-publish on approval', 'Publish the moment Leadership approves.'], ['autoScheduling', 'Auto-scheduling', 'Let the Calendar Agent pick dates and times.']].map(([k, l, h]) => <div key={k} className="flex items-center justify-between gap-3"><div><div>{l}</div><div className="text-[11px] text-ink-3">{h}</div></div><Switch checked={Boolean(settings[k as 'autoPublish'])} disabled={k === 'approvalRequired'} onChange={(v) => updateSettings({ [k]: v })} /></div>)}</div>
        </section>
        <section className="card p-5 anim-fade-up xl:col-span-2" style={{ animationDelay: '240ms' }}><div className="flex items-center justify-between"><h3 className="display text-base">Integrations</h3><Badge tone={apiMode === 'live' ? 'good' : 'warn'}>{apiMode === 'live' ? 'Connected to agent runtime' : 'Standalone — runtime not reachable'}</Badge></div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">{services.map((s) => <div key={s.name} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs"><div><div className="font-medium text-sm">{s.name}</div><div className="text-ink-3">{s.st.configured ? s.st.reason : `Switch on with ${s.env}`}</div></div><Badge tone={s.st.configured ? 'good' : 'neutral'}>{s.st.configured ? 'live' : 'not set'}</Badge></div>)}</div>
        </section>
      </div>
    </div>
  )
}
