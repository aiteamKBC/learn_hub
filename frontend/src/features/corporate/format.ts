import { money } from '@/lib/format'

export const gbp = (minor: number) => money(minor, 'GBP')

export function fullDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
