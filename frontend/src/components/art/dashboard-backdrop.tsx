/**
 * The shared dashboard background: one piece of artwork behind every workspace and the
 * learner area (business, instructor studio, admin console, "my learning"). It is fixed
 * to the viewport and covers it, so it stays put while the page scrolls. The home and
 * sign-in pages keep their own backgrounds. In dark mode the bright artwork is toned
 * right down so the dark theme and page content stay readable.
 */
import dashboardBg from '@/assets/brand/dashboard-bg.png'
import { cn } from '@/lib/cn'

export function DashboardBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 -z-0 overflow-hidden select-none', className)}>
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${dashboardBg})`, backgroundAttachment: 'fixed' }}
      />
      <div className="absolute inset-0 bg-transparent dark:bg-background/85" />
    </div>
  )
}
