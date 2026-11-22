import { ArrowUp } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import { smoothScrollTo } from '@/lib/smooth-scroll'

/**
 * Floating "back to top" control. Fades in once the page is scrolled past the fold and
 * smooth-scrolls to the top (honouring reduced motion via smoothScrollTo). Sits above the
 * mobile bottom bar on phones, bottom-right on larger screens.
 */
export function ScrollToTop() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => smoothScrollTo(0)}
      className={cn(
        'fixed right-4 bottom-20 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-surface text-text shadow-lg backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:text-primary active:scale-95 motion-reduce:transition-none sm:right-6 md:bottom-6',
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <ArrowUp className="size-5" />
    </button>
  )
}
