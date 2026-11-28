import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { Toaster } from 'sonner'

import { queryClient } from '@/api/queryClient'
import { AuthAlertHost } from '@/components/ui/auth-alert'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider, useTheme } from '@/lib/theme'

function PassiveNotices() {
  const { dark } = useTheme()
  return <Toaster theme={dark ? 'dark' : 'light'} position="top-center" offset={{ top: 72 }} mobileOffset={{ top: 68 }} closeButton toastOptions={{ className: 'font-sans' }} />
}

export function Providers({ children }: { children: ReactNode }) {
  // Sets the csrftoken cookie once; every write sends it back as X-CSRFToken.
  useEffect(() => {
    void fetch('/api/v1/identity/csrf', { credentials: 'include' })
  }, [])

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <PassiveNotices />
          <AuthAlertHost />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
