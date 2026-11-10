import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes, useState } from 'react'

import { cn } from '@/lib/cn'

import { Input } from './input'

/** A password field with a show/hide button. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput({ className, ...props }, ref) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={shown ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20 [&_svg]:size-4"
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </div>
  )
})

const LEVELS = [
  { label: 'Too short', tone: 'bg-danger', text: 'text-danger' },
  { label: 'Weak', tone: 'bg-danger', text: 'text-danger' },
  { label: 'Fair', tone: 'bg-warning', text: 'text-warning' },
  { label: 'Good', tone: 'bg-info', text: 'text-info' },
  { label: 'Strong', tone: 'bg-success', text: 'text-success' },
] as const

const COMMON = /^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|123456|abc123|111111)/i

/** 0 = too short, 1 weak … 4 strong. A guide for the person typing; the server's
 * password rules (length, common passwords, similarity to the email) still decide. */
export function passwordScore(pw: string, minLength: number): number {
  if (pw.length < minLength) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  let score = 1
  if (pw.length >= minLength + 4) score++
  if (kinds >= 3) score++
  if (pw.length >= 14 && kinds >= 2) score++
  if (COMMON.test(pw) || /^(.)\1+$/.test(pw) || /^(?:0123|1234|abcd)/i.test(pw)) score = 1
  return Math.min(score, 4)
}

export function PasswordStrength({ password, minLength }: { password: string; minLength: number }) {
  if (!password) return null
  const score = passwordScore(password, minLength)
  const level = LEVELS[score]
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none', i <= Math.max(score, 1) ? level.tone : 'bg-surface-2')} />
        ))}
      </div>
      <p className="text-xs text-muted">
        Password strength: <span className={cn('font-medium', level.text)}>{level.label}</span>
        {score > 0 && score < 3 ? ' · add length, capitals, numbers or symbols' : null}
      </p>
    </div>
  )
}
