import { Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme'

import { Button } from './button'

/** One-tap theme switch: click flips straight between light and dark — no dropdown. */
export function ThemeToggle({ className, onDark }: { className?: string; onDark?: boolean }) {
  const { dark, setChoice } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setChoice(dark ? 'light' : 'dark')}
      className={cn(onDark && 'text-nav-text hover:bg-nav-hover hover:text-white', className)}
    >
      {dark ? <Moon /> : <Sun />}
    </Button>
  )
}
