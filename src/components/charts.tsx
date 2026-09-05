// The only file that imports Recharts.
import { useMemo, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../store'
import { fmt } from './ui'

export const SERIES = { linkedin: '#3987e5', instagram: '#d55181', x: '#19a219', accent: '#7a99d1' } as const
const CHROME = {
  dark: { grid: 'rgba(122,153,209,0.14)', axis: '#8a8fa5', hover: 'rgba(122,153,209,0.08)', legend: '#c5cbe9' },
  light: { grid: 'rgba(83,78,125,0.16)', axis: '#767390', hover: 'rgba(84,112,194,0.08)', legend: '#4a4763' },
}
function useChrome() { const theme = useStore((s) => s.theme); return CHROME[theme] }

export interface Series { key: string; label: string; color: string }
type Row = Record<string, unknown>

export function ChartTooltip({ active, payload, label, series, period, totals }: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number; color?: string }>; label?: string | number; series: Series[]; period: string; totals: Record<string, number> }) {
  if (!active || !payload?.length) return null
  const combined = payload.reduce((n, p) => n + (typeof p.value === 'number' ? p.value : 0), 0)
  return (
    <div className="card px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{label}</div>
      {payload.map((p) => { const s = series.find((x) => x.key === p.dataKey); const v = typeof p.value === 'number' ? p.value : 0; const total = totals[String(p.dataKey)] || 1; return (
        <div key={String(p.dataKey)} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: s?.color ?? p.color }} /><span className="w-20 text-ink-2">{s?.label ?? p.dataKey}</span><span className="tabular font-medium">{fmt(v)}</span><span className="tabular text-ink-3">{((v / total) * 100).toFixed(1)}% of {period}</span>{payload.length > 1 && <span className="tabular text-ink-3">· {((v / Math.max(1, combined)) * 100).toFixed(0)}% of point</span>}</div>
      ) })}
      {payload.length > 1 && <div className="mt-1 border-t border-line pt-1 flex justify-between font-semibold"><span>Total</span><span className="tabular">{fmt(combined)}</span></div>}
    </div>
  )
}

function useTotals(data: Row[], series: Series[]) { return useMemo(() => Object.fromEntries(series.map((s) => [s.key, data.reduce((n, r) => n + (Number(r[s.key]) || 0), 0)])), [data, series]) }

export function TrendLine({ data, xKey, series, height = 200, period = 'period' }: { data: Row[]; xKey: string; series: Series[]; height?: number; period?: string }) {
  const ch = useChrome(); const totals = useTotals(data, series)
  return (
    <div className="chart-scroll chart-reveal"><ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={ch.grid} vertical={false} /><XAxis dataKey={xKey} tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip cursor={{ stroke: ch.grid }} content={<ChartTooltip series={series} period={period} totals={totals} />} />
        {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4.5 }} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>{series.length > 1 && <Legend series={series} />}</div>
  )
}
function Legend({ series }: { series: Series[] }) { return <div className="mt-1 flex flex-wrap gap-3 px-1 text-[11px] text-ink-2">{series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}</div> }

export function TrendArea({ data, xKey, series, height = 200, period = 'period' }: { data: Row[]; xKey: string; series: Series[]; height?: number; period?: string }) {
  const ch = useChrome(); const totals = useTotals(data, series)
  return (
    <div className="chart-scroll chart-reveal"><ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>{series.map((s) => <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.35} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
        <CartesianGrid stroke={ch.grid} vertical={false} /><XAxis dataKey={xKey} tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip cursor={{ stroke: ch.grid }} content={<ChartTooltip series={series} period={period} totals={totals} />} />
        {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#grad-${s.key})`} dot={false} activeDot={{ r: 4.5 }} isAnimationActive={false} />)}
      </AreaChart>
    </ResponsiveContainer>{series.length > 1 && <Legend series={series} />}</div>
  )
}

export function BarsChart({ data, xKey, yKey, height = 200, colorBy, label = 'Value' }: { data: Row[]; xKey: string; yKey: string; height?: number; colorBy?: (row: Row) => string; label?: string }) {
  const ch = useChrome(); const series = [{ key: yKey, label, color: SERIES.accent }]; const totals = useTotals(data, series)
  return (
    <div className="chart-scroll chart-reveal"><ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={ch.grid} vertical={false} /><XAxis dataKey={xKey} tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
        <Tooltip cursor={{ fill: ch.hover }} content={<ChartTooltip series={series} period="total" totals={totals} />} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>{data.map((r, i) => <Cell key={i} fill={colorBy ? colorBy(r) : SERIES.accent} />)}</Bar>
      </BarChart>
    </ResponsiveContainer></div>
  )
}

export function ChartCard({ title, subtitle, children, actions, className = '' }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}><div className="mb-3 flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{title}</div>{subtitle && <div className="text-xs text-ink-3">{subtitle}</div>}</div>{actions}</div>{children}</div>
}

export interface InsightDetail<T> { key: string; label: string; format?: (v: number, row: T) => string; derive?: (row: T) => number }

/** One graph tells the whole story: gradient area, avg line, peak marker, rich tooltip, four chips. */
export function InsightChart<T extends object>({ data: rawData, xKey, valueKey, valueLabel, period, details = [], color = SERIES.accent, height = 240, format = fmt }: { data: T[]; xKey: string; valueKey: string; valueLabel: string; period: string; details?: Array<InsightDetail<T>>; color?: string; height?: number; format?: (n: number) => string }) {
  const ch = useChrome()
  const data = rawData as unknown as Row[]
  const stats = useMemo(() => {
    const vals = data.map((r) => Number(r[valueKey]) || 0)
    const total = vals.reduce((a, b) => a + b, 0); const avg = total / Math.max(1, vals.length)
    const peakIdx = vals.indexOf(Math.max(...vals)); const above = vals.filter((v) => v > avg).length
    return { total, avg, peakIdx, above, peak: vals[peakIdx] ?? 0, peakX: data[peakIdx]?.[xKey] }
  }, [data, valueKey, xKey])
  const Tip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: Row }> }) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as unknown as Row; const v = Number(row[valueKey]) || 0; const vsAvg = ((v - stats.avg) / Math.max(1, stats.avg)) * 100; const isPeak = row[xKey] === stats.peakX
    return (
      <div className="card px-3 py-2 text-xs shadow-xl min-w-[200px]">
        <div className="flex items-center justify-between gap-2"><span className="font-medium">Day {String(row[xKey])}</span>{isPeak && <span className="rounded-full bg-magenta/20 px-1.5 text-[10px] font-semibold text-magenta-ink">Peak</span>}</div>
        <div className="tabular mt-1 text-base font-semibold" style={{ color }}>{format(v)} <span className="text-[11px] font-normal text-ink-3">{valueLabel}</span></div>
        <div className="tabular text-ink-3">{((v / Math.max(1, stats.total)) * 100).toFixed(1)}% of {period} · <span className={vsAvg >= 0 ? 'text-good-ink' : 'text-critical-ink'}>{vsAvg >= 0 ? '+' : ''}{vsAvg.toFixed(0)}% vs avg</span></div>
        {details.length > 0 && <div className="mt-1.5 border-t border-line pt-1.5 space-y-0.5">{details.map((d) => { const typed = row as unknown as T; const dv = d.derive ? d.derive(typed) : Number(row[d.key]) || 0; return <div key={d.key} className="flex justify-between gap-3"><span className="text-ink-3">{d.label}</span><span className="tabular">{d.format ? d.format(dv, typed) : fmt(dv)}</span></div> })}</div>}
      </div>
    )
  }
  return (
    <div>
      <div className="chart-scroll chart-reveal"><ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 22, right: 12, left: -14, bottom: 0 }}>
          <defs><linearGradient id="insight-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.4} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke={ch.grid} vertical={false} /><XAxis dataKey={xKey} tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(data.length / 10) - 1)} /><YAxis tick={{ fill: ch.axis, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip cursor={{ stroke: ch.grid }} content={<Tip />} />
          <ReferenceLine y={stats.avg} stroke={ch.axis} strokeDasharray="4 4" label={{ value: `avg ${format(stats.avg)}`, position: 'insideTopRight', fill: ch.axis, fontSize: 11 }} />
          <Area type="monotone" dataKey={valueKey} stroke={color} strokeWidth={2.25} fill="url(#insight-grad)" dot={false} activeDot={{ r: 4.5 }} isAnimationActive={false} />
          {stats.peakX != null && <ReferenceDot x={stats.peakX as string | number} y={stats.peak} r={5} fill={color} stroke="var(--color-surface)" strokeWidth={2} label={{ value: `Peak · day ${String(stats.peakX)}`, position: 'top', fill: ch.legend, fontSize: 11 }} shape={(p: { cx?: number; cy?: number }) => <g><circle cx={p.cx} cy={p.cy} r={9} fill={color} fillOpacity={0.35} className="peak-pulse" /><circle cx={p.cx} cy={p.cy} r={5} fill={color} stroke="var(--color-surface)" strokeWidth={2} /></g>} />}
        </AreaChart>
      </ResponsiveContainer></div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 stagger-fade">
        {[['Peak', `${format(stats.peak)} · day ${String(stats.peakX ?? '—')}`], ['Daily average', format(stats.avg)], ['Days above average', `${stats.above} of ${data.length}`], ['Total this period', format(stats.total)]].map(([k, v], i) => <div key={k} className="rounded-lg border border-line bg-surface-2 px-3 py-2" style={{ ['--i' as string]: i }}><div className="text-[10px] uppercase tracking-wide text-ink-3">{k}</div><div className="tabular text-sm font-semibold">{v}</div></div>)}
      </div>
    </div>
  )
}
