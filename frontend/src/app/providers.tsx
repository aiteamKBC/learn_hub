import { QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { Toaster } from 'sonner'

import { queryClient } from '@/api/queryClient'
import { AuthAlertHost } from '@/components/ui/auth-alert'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider, useTheme } from '@/lib/theme'

function Toasts() {
  const { dark } = useTheme()
  return <Toaster theme={dark ? "dark" : "light"} position="top-center" offset={{ top: 76 }} mobileOffset={{ top: 72 }} richColors closeButton toastOptions={{ className: "font-sans" }} />
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
          <Toasts />
          <AuthAlertHost />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
