import { CreditCard, Search } from 'lucide-react'
import type { ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

// Small pieces shared by the console's money pages (sales, subscriptions, pricing, promotions).

const BRAND: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', jcb: 'JCB', unionpay: 'UnionPay', diners: 'Diners' }
const METHOD: Record<string, string> = { card: 'Card', paypal: 'PayPal', link: 'Link', bacs_debit: 'Bacs Direct Debit', sepa_debit: 'SEPA Direct Debit' }

/** "Visa •••• 4242", "PayPal" or "—" (orders paid before Stripe sent card details). */
export function PaymentMethod({ method, brand, last4, className }: { method: string; brand: string; last4: string; className?: string }) {
  if (!method && !brand) return <span className="text-muted">—</span>
  const label = brand ? `${BRAND[brand] ?? brand}${last4 ? ` •••• ${last4}` : ''}` : (METHOD[method] ?? method)
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <CreditCard className="size-4 shrink-0 text-muted" aria-hidden />
      {label}
    </span>
  )
}

/** A compact search box for table toolbars. */
export function SearchBox({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder: string; className?: string }) {
  return <Input icon={<Search />} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder} className={cn('w-full', className)} type="search" />
}

/** The toolbar row above a table: wraps on phones, never scrolls the page sideways. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3 [&>*]:min-w-0">{children}</div>
}

/** "12 Mar 2026, 14:27" in the reader's time zone. */
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
/** For <input type="datetime-local">: local wall-clock time without seconds. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** Major-unit text from an input ("12.50") to minor units, or null when not a number. */
export function toMinor(text: string, exponent = 2): number | null {
  const t = text.trim().replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const [whole, frac = ''] = t.split('.')
  if (frac.length > exponent) return null
  return Number(whole) * 10 ** exponent + Number((frac + '0'.repeat(exponent)).slice(0, exponent) || 0)
}
export const toMajor = (minor: number, exponent = 2) => (minor / 10 ** exponent).toFixed(exponent)
