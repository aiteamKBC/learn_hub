/** Formatting helpers. Money arrives in minor units with its exponent, never floats. */

export function money(minor: number, currency: string, exponent = 2): string {
  const value = minor / 10 ** exponent
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: value % 1 === 0 && exponent > 0 ? 0 : exponent,
    maximumFractionDigits: exponent,
  }).format(value)
}

export function duration(sec: number): string {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`
}

export function count(n: number): string {
  return new Intl.NumberFormat('en-GB', { notation: n >= 10_000 ? 'compact' : 'standard' }).format(n)
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`
}

const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' })

/** "today", "in 3 days", "2 weeks ago", "3 months ago": one style everywhere. */
export function relativeDate(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  const a = Math.abs(days)
  if (a < 1) return 'today'
  if (a < 14) return rtf.format(days, 'day')
  if (a < 60) return rtf.format(Math.round(days / 7), 'week')
  if (a < 365) return rtf.format(Math.round(days / 30), 'month')
  return rtf.format(Math.round(days / 365), 'year')
}

// Console > Settings: the platform's date format and time zone (set once by SiteRoot).
const DATE_STYLES: Record<string, [string, Intl.DateTimeFormatOptions]> = {
  'd MMM yyyy': ['en-GB', { day: 'numeric', month: 'short', year: 'numeric' }],
  'dd/MM/yyyy': ['en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }],
  'yyyy-MM-dd': ['en-CA', { day: '2-digit', month: '2-digit', year: 'numeric' }],
}
let datePrefs: { format: string; timeZone?: string } = { format: 'd MMM yyyy' }

export function setDatePrefs(format: string, timeZone?: string) {
  let tz: string | undefined = timeZone
  try {
    if (tz) new Intl.DateTimeFormat('en-GB', { timeZone: tz })
  } catch {
    tz = undefined // an unknown zone falls back to the browser's
  }
  datePrefs = { format: DATE_STYLES[format] ? format : 'd MMM yyyy', timeZone: tz }
}

export function shortDate(iso: string): string {
  const [locale, opts] = DATE_STYLES[datePrefs.format]!
  return new Date(iso).toLocaleDateString(locale, { ...opts, timeZone: datePrefs.timeZone })
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}
