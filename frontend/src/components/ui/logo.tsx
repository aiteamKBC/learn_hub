import { usePublicSettings } from '@/features/platform/api'
import { cn } from '@/lib/cn'
import brandLogo from '@/assets/brand/logo.png'

/** The brand mark (the bird) on its own, for collapsed/compact spots. */
export function LogoMark({ className }: { className?: string }) {
  return <img src={brandLogo} alt="" className={cn('h-8 w-auto object-contain', className)} aria-hidden />
}

/** The platform's logo: the uploaded one (console > Settings), or the brand bird. No wordmark. */
export function Logo({ className, inverted: _inverted }: { className?: string; inverted?: boolean }) {
  const { settings } = usePublicSettings()
  const name = settings['general.platform_name'] || 'LearnHub'
  const src = settings['general.logo_url']
  if (src) return <img src={src} alt={name} className={cn('h-8 w-auto max-w-[160px] object-contain', className)} />
  return <img src={brandLogo} alt={name} className={cn('h-9 w-auto object-contain', className)} />
}
