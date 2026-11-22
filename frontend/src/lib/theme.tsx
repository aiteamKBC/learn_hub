import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark'

const KEY = 'theme'

function read(): ThemeChoice {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const ThemeContext = createContext<{ choice: ThemeChoice; dark: boolean; setChoice: (c: ThemeChoice) => void }>({
  choice: 'light',
  dark: false,
  setChoice: () => {},
})

/** Light or dark. The choice is a per-browser convenience. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(read)
  const dark = choice === 'dark'

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
