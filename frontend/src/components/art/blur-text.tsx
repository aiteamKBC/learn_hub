/**
 * Blur Text (React Bits–style): words resolve from a soft blur + rise into place on mount,
 * driven by GSAP. Text and colour are untouched — the parent sets those. Reduced motion
 * shows the text immediately.
 */
import { gsap } from 'gsap'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/cn'
import { reducedMotion } from '@/lib/motion'

export function BlurText({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const words = text.split(' ')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const parts = el.querySelectorAll('[data-w]')
    if (reducedMotion()) {
      gsap.set(parts, { opacity: 1, filter: 'blur(0px)', y: 0 })
      return
    }
    const ctx = gsap.context(() => {
      gsap.fromTo(
        parts,
        { opacity: 0, filter: 'blur(12px)', y: 14 },
        { opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, delay },
      )
    }, el)
    return () => ctx.revert()
  }, [delay])

  return (
    <span ref={ref} className={cn('inline', className)}>
      {words.map((w, i) => (
        <span key={i} data-w className="inline-block will-change-[filter,transform,opacity]" style={{ opacity: 0 }}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}
