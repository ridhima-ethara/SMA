import { Moon, Sun } from 'lucide-react'
import { useStore } from '../store'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useStore((s) => s.theme)
  const toggle = useStore((s) => s.toggleTheme)
  return (
    <button type="button" onClick={toggle} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-label="Toggle theme" className={`grid h-8 w-8 place-items-center rounded-full border border-line bg-surface-2 text-ink-2 transition-colors hover:text-ink ${className}`}>
      {theme === 'dark' ? <Sun size={15} key="sun" className="theme-icon" /> : <Moon size={15} key="moon" className="theme-icon" />}
    </button>
  )
}
