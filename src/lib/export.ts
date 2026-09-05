// CSV export helpers for the Download menus.
export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const cols = Array.from(rows.reduce<Set<string>>((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s }, new Set()))
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDataUri(filename: string, dataUri: string): void {
  const a = document.createElement('a')
  a.href = dataUri
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
