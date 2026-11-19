import { Heart, ShoppingCart } from 'lucide-react'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { CourseRow } from '@/features/catalog/CourseRow'
import { useAddToCart, useRemoveWishlist, useWishlist } from '@/features/commerce/api'
import { Link, useNavigate } from '@/lib/router'
import { authAlert } from '@/lib/auth-alert'

export function WishlistPage() {
  const { data, isLoading, error, refetch } = useWishlist()
  const add = useAddToCart()
  const navigate = useNavigate()
  const remove = useRemoveWishlist()
  const fail = (e: unknown) => toast.error((e as Error).message)
  return (
    <>
      <PageHeader title="Wishlist" description="Courses you saved for later." />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <div className="grid gap-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-36 rounded-lg" />
        </div>
      ) : !data.items.length ? (
        <Card className="animate-reveal">
          <EmptyState icon={<Heart />} title="Nothing saved yet" body="Tap the heart on any course to keep it here." action={<Button asChild><Link to="/courses">Browse courses</Link></Button>} />
        </Card>
      ) : (
        <ul className="stagger grid gap-3">
          {data.items.map((c) => (
            <li key={c.id}>
              <CourseRow
                course={c}
                actions={
                  <>
                    {c.price && !c.price.free ? <Button size="sm" loading={add.isPending && add.variables === c.id} onClick={() => add.mutate(c.id, { onSuccess: () => authAlert({ kind: 'cart', title: 'Added to your cart', text: c.title, autoClose: 3500, action: { label: 'View cart', onClick: () => navigate('/cart') } }), onError: fail })}>
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
