/**
 * Light Rays (React Bits–style): a slow fan of brand-orange rays with a soft pulsing glow,
 * for a dark hero. Decorative, additive (screen blend), and subtle. Static under reduced
 * motion.
 */
import { gsap } from 'gsap'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/cn'
import { reducedMotion } from '@/lib/motion'

export function LightRays({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.to('[data-rays]', { rotation: 360, duration: 120, repeat: -1, ease: 'none', transformOrigin: '50% 0%' })
      gsap.to('[data-glow]', { opacity: 0.55, scale: 1.12, duration: 5, repeat: -1, yoyo: true, ease: 'sine.inOut' })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={ref} aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div
        data-rays
        className="absolute top-[-50%] left-1/2 h-[200%] w-[200%] -translate-x-1/2 opacity-[0.16] mix-blend-screen"
        style={{ background: 'repeating-conic-gradient(from 0deg at 50% 0%, rgba(234,128,45,0.55) 0deg, transparent 5deg 15deg)' }}
      />
      <div
        data-glow
        className="absolute top-0 left-1/2 h-[65%] w-[75%] -translate-x-1/2 opacity-30 mix-blend-screen"
        style={{ background: 'radial-gradient(60% 60% at 50% 0%, rgba(234,128,45,0.5), transparent 70%)' }}
      />
    </div>
  )
}
