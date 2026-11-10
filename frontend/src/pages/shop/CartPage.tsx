import { Heart, Lock, ShoppingCart, Tag, Trash2, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCourses } from '@/features/catalog/api'
import { CourseGrid } from '@/features/catalog/CourseCard'
import { CourseRow } from '@/features/catalog/CourseRow'
import { useCart, useCheckout, useCurrencies, useRemoveFromCart, useToggleWishlist } from '@/features/commerce/api'
import { cn } from '@/lib/cn'
import { useCurrency } from '@/lib/currency'
import { money } from '@/lib/format'
import { useNavigate } from '@/lib/router'

export function CartPage() {
  const [coupon, setCoupon] = useState<string | undefined>()
  const [code, setCode] = useState('')
  const { data: cart, isLoading, error, refetch, isFetching } = useCart(coupon)
  const remove = useRemoveFromCart()
  const wish = useToggleWishlist()
  const checkout = useCheckout()
  const { data: currencies } = useCurrencies()
  const { setCurrency } = useCurrency()
  const navigate = useNavigate()
  const popular = useCourses({ sort: 'popular', limit: 4 })

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setCoupon(code.trim() || undefined)
  }
  const pay = () => {
    if (!cart) return
    checkout.mutate(
      { courseIds: cart.lines.map((l) => l.course.id), currency: cart.currency, coupon: cart.coupon ?? undefined },
      {
        // Stripe hosts the card form: the card never touches LearnHub
        onSuccess: (r) => (r.checkout_url ? window.location.assign(r.checkout_url) : navigate(`/checkout/success?order=${r.order_id}`)),
        onError: (e) => toast.error((e as Error).message),
      },
    )
  }
  const fmt = (n: number) => (cart ? money(n, cart.currency, cart.exponent) : '')

  return (
    <div className="relative isolate">
      <Backdrop variant="mosaic" seed={44} height={340} />
      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your cart</h1>
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !cart ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="grid gap-3">
              <Skeleton className="h-36 rounded-lg" />
              <Skeleton className="h-36 rounded-lg" />
            </div>
            <Skeleton className="h-72 rounded-lg" />
          </div>
        ) : !cart.lines.length ? (
          <>
            <Card className="mt-6 animate-reveal">
              <EmptyState icon={<ShoppingCart />} title="Your cart is empty" body="Find a course you like and add it here." action={<Button onClick={() => navigate('/courses')}>Browse courses</Button>} />
            </Card>
            <h2 className="mt-12 mb-4 text-lg font-semibold">Popular right now</h2>
            <CourseGrid courses={popular.data?.items} loading={popular.isLoading} count={4} />
          </>
        ) : (
          <div className={cn('mt-6 grid animate-reveal items-start gap-6 transition-opacity lg:grid-cols-[1fr_360px]', isFetching && 'opacity-70')}>
            <section aria-label="Courses in your cart">
              <p className="mb-3 text-sm text-muted">
                {cart.lines.length} {cart.lines.length === 1 ? 'course' : 'courses'}
              </p>
              <ul className="stagger grid gap-3">
                {cart.lines.map((l) => (
                  <li key={l.course.id}>
                    <CourseRow
                      course={l.course}
                      aside={
                        <div className="text-right">
                          <p className="text-lg font-semibold tabular">{fmt(l.price_minor)}</p>
                          {l.price_minor < l.list_minor ? <p className="text-[13px] text-subtle line-through tabular">{fmt(l.list_minor)}</p> : null}
                        </div>
                      }
                      actions={
                        <>
                          <Button variant="link" size="sm" className="text-danger" onClick={() => remove.mutate(l.course.id, { onSuccess: () => toast.success(`Removed “${l.course.title}”`) })}>
                            <Trash2 /> Remove
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() =>
                              remove.mutate(l.course.id, {
                                onSuccess: () => wish.mutate(l.course.id, { onSuccess: () => toast.success('Moved to your wishlist') }),
                              })
                            }
                          >
                            <Heart /> Move to wishlist
                          </Button>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>

            <aside className="lg:sticky lg:top-24">
              <Card className="p-5 shadow">
                <p className="text-sm font-medium text-muted">Total</p>
                <p className="mt-1 text-4xl font-bold tracking-tight tabular">{fmt(cart.total_minor)}</p>
                {cart.discount_minor ? (
                  <p className="mt-1 text-sm text-muted">
                    <span className="line-through tabular">{fmt(cart.subtotal_minor)}</span> <span className="font-medium text-success">You save {fmt(cart.discount_minor)}</span>
                  </p>
                ) : null}
                <Button size="lg" className="mt-5 w-full" loading={checkout.isPending} disabled={isFetching} onClick={pay}>
                  <Lock /> {cart.total_minor ? 'Checkout' : 'Enrol now'}
                </Button>
                <p className="mt-2 text-center text-xs text-muted">Secure payment by Stripe · 30-day refunds</p>

                <div className="mt-5 border-t border-border pt-5">
                  {cart.coupon ? (
                    <div className="flex items-center justify-between rounded-md bg-success-soft px-3 py-2 text-sm text-success">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <Tag className="size-4" /> {cart.coupon} applied
                      </span>
                      <Button variant="ghost" size="icon-sm" aria-label="Remove coupon" onClick={() => (setCoupon(undefined), setCode(''))}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={apply} className="flex gap-2">
                      <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" maxLength={40} aria-invalid={cart.coupon_error ? true : undefined} />
                      <Button type="submit" variant="secondary" disabled={!code.trim()}>
                        Apply
                      </Button>
                    </form>
                  )}
                  {cart.coupon_error ? (
                    <p role="alert" className="mt-2 text-[13px] text-danger">
                      {cart.coupon_error}
                    </p>
                  ) : null}
                  {cart.promotion ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-success">
                      <Tag className="size-3.5" aria-hidden /> Offer applied: {cart.promotion}
                    </p>
                  ) : null}
                </div>

                {currencies && currencies.length > 1 ? (
                  <label className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
                    Pay in
                    <NativeSelect value={cart.currency} onChange={(e) => void setCurrency(e.target.value)} className="h-9 w-32">
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ) : null}
              </Card>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
