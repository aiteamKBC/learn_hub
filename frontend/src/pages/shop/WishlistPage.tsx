import { Heart, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { CourseRow } from '@/features/catalog/CourseRow'
import { useAddToCart, useRemoveWishlist, useWishlist } from '@/features/commerce/api'
import { Link } from '@/lib/router'

export function WishlistPage() {
  const { data, isLoading, error, refetch } = useWishlist()
  const add = useAddToCart()
  const remove = useRemoveWishlist()
  const fail = (e: unknown) => toast.error((e as Error).message)
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[26px]">Wishlist</h1>
      <p className="mt-1 text-sm text-muted">Courses you saved for later.</p>
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="mt-6 grid gap-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : !data.items.length ? (
        <Card className="mt-6 animate-reveal">
          <EmptyState icon={<Heart />} title="Nothing saved yet" body="Tap the heart on any course to keep it here." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} />
        </Card>
      ) : (
        <ul className="stagger mt-6 grid gap-3">
          {data.items.map((c) => (
            <li key={c.id}>
              <CourseRow
                course={c}
                actions={
                  <>
                    {c.price && !c.price.free ? <Button size="sm" loading={add.isPending && add.variables === c.id} onClick={() => add.mutate(c.id, { onSuccess: () => toast.success('Added to your cart'), onError: fail })}>
                      <ShoppingCart /> Add to cart
                    </Button> : <Button size="sm" asChild><Link to={`/courses/${c.slug}`}>View course</Link></Button>}
                    <Button size="sm" variant="ghost" loading={remove.isPending && remove.variables === c.id} onClick={() => remove.mutate(c.id, { onSuccess: () => toast.success('Removed from your wishlist'), onError: fail })}>
                      <Heart className="fill-danger text-danger" /> Remove
                    </Button>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
