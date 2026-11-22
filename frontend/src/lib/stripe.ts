/** Loads Stripe.js from Stripe's own domain. Stripe requires its script to be served from
 * js.stripe.com (never bundled) for PCI, so this is also why we add no npm dependency: the
 * embedded card fields are iframes hosted by Stripe, and the card never touches our code. */

export type StripeElementEvent = {
  complete?: boolean
  empty?: boolean
  error?: { message?: string }
  availablePaymentMethods?: Record<string, boolean> | null
}

export type StripeElement = {
  mount: (el: HTMLElement) => void
  unmount: () => void
  destroy: () => void
  on: (event: string, handler: (e: StripeElementEvent) => void) => void
}

export type StripeElements = {
  create: (type: string, options?: Record<string, unknown>) => StripeElement
  getElement: (type: string) => StripeElement | null
  submit: () => Promise<{ error?: { message?: string } }>
  update: (options: Record<string, unknown>) => void
}

export type StripeInstance = {
  elements: (options: Record<string, unknown>) => StripeElements
  confirmPayment: (options: {
    elements: StripeElements
    confirmParams: {
      return_url: string
      receipt_email?: string
      payment_method_data?: { billing_details?: { email?: string } }
    }
    redirect?: 'if_required'
  }) => Promise<{ error?: { message?: string; type?: string } }>
}

declare global {
  interface Window {
    Stripe?: (key: string, options?: Record<string, unknown>) => StripeInstance
  }
}

const SRC = 'https://js.stripe.com/v3/'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.Stripe) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)
    const el = existing ?? document.createElement('script')
    const onLoad = () => (window.Stripe ? resolve() : reject(new Error('Could not load Stripe.')))
    el.addEventListener('load', onLoad)
    el.addEventListener('error', () => reject(new Error('Could not load Stripe.')))
    if (!existing) {
      el.src = SRC
      el.async = true
      document.head.appendChild(el)
    } else if (window.Stripe) {
      resolve()
    }
  })
  return scriptPromise
}

/** Start downloading Stripe.js while the checkout intent is being created. */
export function preloadStripe(): Promise<void> {
  return loadScript()
}

const cache = new Map<string, StripeInstance>()

/** Resolve a Stripe instance for a publishable key (loads the script once, caches per key). */
export async function getStripe(publishableKey: string): Promise<StripeInstance> {
  if (!publishableKey) throw new Error('Payments are not configured.')
  const hit = cache.get(publishableKey)
  if (hit) return hit
  await loadScript()
  if (!window.Stripe) throw new Error('Could not load Stripe.')
  const instance = window.Stripe(publishableKey)
  cache.set(publishableKey, instance)
  return instance
}
