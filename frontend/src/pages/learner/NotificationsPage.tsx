import { BellOff, CheckCheck } from 'lucide-react'
import { useState } from 'react'

import { LearnerHeader } from '@/components/layout/learner-header'
import { NotificationRow, useOpenNotification } from '@/components/layout/NotificationBell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useMarkRead, useNotifications } from '@/features/engagement/api'
import { cn } from '@/lib/cn'

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const q = useNotifications(unreadOnly)
  const mark = useMarkRead()
  const open = useOpenNotification()
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  const unread = q.data?.pages[0]?.unread ?? 0

  return (
    <>
      <LearnerHeader>
        <div className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[26px]">Notifications</h1>
              <p className="mt-1 text-sm text-muted">{unread ? `${unread} unread` : 'Answers to your questions, announcements, new training and more.'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Segmented filter, with a highlight that slides between the two slots. */}
              <div role="group" aria-label="Filter notifications" className="relative inline-flex rounded-full border border-border bg-surface p-1 text-sm shadow-sm">
                <span aria-hidden className={cn('pointer-events-none absolute top-1 bottom-1 left-1 w-24 rounded-full bg-primary shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none', unreadOnly && 'translate-x-full')} />
                {[
                  { k: false, label: 'All' },
                  { k: true, label: 'Unread' },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => setUnreadOnly(o.k)}
                    aria-pressed={unreadOnly === o.k}
                    className={cn('relative z-10 w-24 rounded-full px-4 py-1.5 text-center font-medium transition-colors duration-200', unreadOnly === o.k ? 'text-on-primary' : 'text-muted hover:text-text')}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {unread ? (
                <Button size="sm" onClick={() => mark.mutate(null)} loading={mark.isPending}>
                  <CheckCheck /> Mark all read
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </LearnerHeader>
      {q.error ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<BellOff />} title={unreadOnly ? 'Nothing unread' : 'No notifications yet'} body="You're all caught up." />
        </Card>
      ) : (
        <>
          <ul className="stagger grid gap-2.5">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationRow n={n} onOpen={open} />
              </li>
            ))}
          </ul>
          {q.hasNextPage ? (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
                Show older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
