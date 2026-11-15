/** Display-only reference conversion using the active token rate (tokens per GBP penny).
 * It is not a checkout quote: purchased/bonus token grants retain their own unit cost. */
export function tokenValueGbp(tokens: number | null | undefined, tokensPerGbpMinor: number | undefined): string | null {
  if (tokens == null || !Number.isFinite(tokens) || tokens < 0 || !tokensPerGbpMinor || tokensPerGbpMinor <= 0) return null
  return `≈ £${(tokens / tokensPerGbpMinor / 100).toFixed(2)}`
}

export function tokensFromGbp(gbp: number, tokensPerGbpMinor: number): number {
  return Math.round(gbp * 100 * tokensPerGbpMinor)
}

export function gbpForTokenInput(tokens: number, tokensPerGbpMinor: number): string {
  return (tokens / tokensPerGbpMinor / 100).toFixed(2)
}

export function moneyGbp(gbpMinor: number | null | undefined): string | null {
  return gbpMinor == null ? null : `£${(gbpMinor / 100).toFixed(2)}`
}

export function moneyUsd(usdMinor: number | null | undefined): string | null {
  return usdMinor == null ? null : `$${(usdMinor / 100).toFixed(2)}`
}
