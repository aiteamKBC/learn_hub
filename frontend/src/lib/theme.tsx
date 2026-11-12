import { createContext, type ReactNode, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'theme'
const query = '(prefers-color-scheme: dark)'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function subscribeSystem(onChange: () => void) {
  const m = window.matchMedia(query)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
const systemDark = () => window.matchMedia(query).matches

const ThemeContext = createContext<{ choice: ThemeChoice; dark: boolean; setChoice: (c: ThemeChoice) => void }>({
  choice: 'system',
  dark: false,
  setChoice: () => {},
})

/** Light, dark or follow the computer. The choice is a per-browser convenience. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(read)
  const system = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  const dark = choice === 'dark' || (choice === 'system' && system)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0b16' : '#f8f7fc')
  }, [dark])

  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, c)
    } catch {
      /* private mode: the choice lasts for this visit only */
    }
    setChoiceState(c)
  }, [])

  return <ThemeContext.Provider value={{ choice, dark, setChoice }}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react/only-export-components
export const useTheme = () => useContext(ThemeContext)
