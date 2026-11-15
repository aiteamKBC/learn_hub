import { Heart } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useMe } from '@/features/identity/auth'
import { cn } from '@/lib/cn'
import { useNavigate } from '@/lib/router'

import { useToggleWishlist, useWishlist } from './api'

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
  const toggle = useToggleWishlist()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<boolean | null>(null)
  const saved = preview ?? (wishlist.data?.items.some((item) => item.id === courseId) ?? (me ? initialSaved ?? false : false))

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
    setPreview(!saved)
    toggle.mutate(courseId, {
      onSuccess: (result) => {
        setPreview(null)
        toast.success(result.in_wishlist ? 'Saved to your wishlist' : 'Removed from your wishlist')
      },
      onError: (error) => {
        setPreview(null)
        toast.error(error.message)
      },
    })
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      className={cn('rounded-full border bg-surface/95 shadow-sm [&_svg]:size-5', saved && 'border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/80', className)}
      aria-label={saved ? `Remove ${title} from wishlist` : `Save ${title} to wishlist`}
      aria-pressed={saved}
      title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      loading={toggle.isPending}
      disabled={meLoading || (!!me && wishlist.isLoading)}
      onClick={press}
    >
      <Heart className={cn('size-5', saved && 'animate-pop fill-danger text-danger')} />
    </Button>
  )
}
