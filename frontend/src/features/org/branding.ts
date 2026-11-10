/** Company branding at runtime: the company's colours tint the workspace accent only
 * (the sidebar's active item and the header chip). Design tokens are never replaced, and
 * text on a tinted surface is always white or near-black, whichever reads better. */
import type { CSSProperties } from 'react'

export const HEX = /^#[0-9a-fA-F]{6}$/

function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}

const DARK_TEXT = '#14112b'

/** White or near-black: whichever is easier to read on this colour. */
export function textOn(hex: string) {
  return contrast(hex, '#ffffff') >= contrast(hex, DARK_TEXT) ? '#ffffff' : DARK_TEXT
}

// the sidebar background (light and dark themes are both deep navy)
const NAV_BG = '#17133a'

/** CSS variables for the workspace root. Only valid #rrggbb values are used, and a
 * primary colour too close to the navy sidebar is skipped so the active item stays
 * visible. */
export function brandStyle(primary?: string | null, accent?: string | null): CSSProperties | undefined {
  const style: Record<string, string> = {}
  if (primary && HEX.test(primary) && contrast(primary, NAV_BG) >= 1.6) {
    style['--nav-active'] = primary
    style['--nav-text-active'] = textOn(primary)
  }
  const a = accent && HEX.test(accent) ? accent : primary && HEX.test(primary) ? primary : null
  if (a) {
    style['--brand-accent'] = a
    style['--brand-accent-text'] = textOn(a)
  }
  return Object.keys(style).length ? (style as CSSProperties) : undefined
}

/** Only https logos are shown (the API only stores those). */
export function safeLogo(url?: string | null) {
  return url && url.startsWith('https://') ? url : null
}
