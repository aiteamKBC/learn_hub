import { Heart } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useNavigate } from '@/lib/router'
import { toast } from '@/lib/toast'

import { useRemoveWishlist, useSaveWishlist, useWishlist } from './api'

/** One account-scoped heart for catalogue cards and course details. */
export function WishlistHeart({ courseId, slug, title, className, size = 'icon', initialSaved }: {
  courseId: string
  slug: string
  title: string
  className?: string
  size?: 'icon' | 'icon-sm'
  initialSaved?: boolean
}) {
  const { data: me, isLoading: meLoading } = useMe()
  const wishlist = useWishlist()
  const save = useSaveWishlist()
  const remove = useRemoveWishlist()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<boolean | null>(null)
  const desired = useRef<boolean | null>(null)
  const syncing = useRef(false)
  const saved = preview ?? (wishlist.data?.items.some((item) => item.id === courseId) ?? (me ? initialSaved ?? false : false))

  const sync = async (initial: boolean) => {
    if (syncing.current) return
    syncing.current = true
    let committed = initial
    try {
      // Requests stay sequential, but the UI always reflects the latest tap immediately.
      // If someone saves then removes quickly, the remove runs as soon as save finishes.
      while (desired.current !== null && desired.current !== committed) {
        const target = desired.current
        const result = await (target ? save.mutateAsync(courseId) : remove.mutateAsync(courseId))
        committed = result.in_wishlist
      }
      toast.success(committed ? 'Saved to your wishlist' : 'Removed from your wishlist')
    } catch (error) {
      desired.current = committed
      toast.error((error as Error).message)
    } finally {
      desired.current = null
      syncing.current = false
      setPreview(null)
    }
  }

  const press = () => {
    if (!me) {
      navigate(`/login?next=${encodeURIComponent(`/courses/${slug}`)}`)
      return
    }
    if (!wishlist.data) {
      void wishlist.refetch()
      toast.error('Your wishlist could not load. Please try again.')
      return
    }
    const next = !saved
    desired.current = next
    setPreview(next)
    void sync(saved)
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      className={cn('rounded-full border bg-surface/95 shadow-sm [&_svg]:size-5', saved && 'border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/80', className)}
      aria-label={saved ? `Remove ${title} from wishlist` : `Save ${title} to wishlist`}
      aria-pressed={saved}
      aria-busy={save.isPending || remove.isPending || undefined}
      title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      disabled={meLoading || (!!me && wishlist.isLoading)}
      onClick={press}
    >
      <Heart className={cn('size-5', saved && 'animate-pop fill-danger text-danger')} />
    </Button>
  )
}
