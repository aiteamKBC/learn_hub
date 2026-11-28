/**
 * Console > Bundles: the platform admin groups courses into a bundle and sets one seat
 * price. Companies buy seats in the bundle and split them between its courses.
 */
import { Layers, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { useCourses } from '@/features/catalog/api'
import { type ConsoleBundle, useConsoleBundles, useSaveBundle } from '@/features/corporate/api'
import { gbp } from '@/features/corporate/format'
import { cn } from '@/lib/cn'
import { toast } from '@/lib/toast'

function Editor({ bundle, onDone }: { bundle?: ConsoleBundle; onDone: () => void }) {
  const [title, setTitle] = useState(bundle?.title ?? '')
  const [description, setDescription] = useState(bundle?.description ?? '')
  const [pounds, setPounds] = useState(bundle ? String(bundle.seat_price_minor / 100) : '')
  const [active, setActive] = useState(bundle?.is_active ?? true)
  const [picked, setPicked] = useState<string[]>(bundle?.courses.map((c) => c.course_id) ?? [])
  const courses = useCourses({ sort: 'popular', limit: 60 })
  const save = useSaveBundle()
  const price = Math.round(Number(pounds) * 100)
  const ok = title.trim() && price > 0 && picked.length >= 2
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { id: bundle?.id, body: { title, description, seat_price_minor: price, is_active: active, course_ids: picked } },
          { onSuccess: () => (toast.success('Bundle saved.'), onDone()), onError: (err) => toast.error((err as Error).message) },
        )
      }}
    >
      <Field label="Name">{(p) => <Input {...p} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Compliance essentials" />}</Field>
      <Field label="Description" hint="Optional. Shown to companies.">
        {(p) => <Textarea {...p} rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label="Price per seat (£)" hint="Every seat costs this, whichever course it is in.">
        {(p) => <Input {...p} type="number" inputMode="decimal" min={0.01} step={0.01} value={pounds} onChange={(e) => setPounds(e.target.value)} className="w-40" />}
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Courses ({picked.length} chosen, at least 2)</legend>
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border p-2">
          {courses.isLoading ? <Skeleton className="h-24" /> : null}
          {courses.data?.items.map((c) => (
            <label key={c.id} className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-surface-2', picked.includes(c.id) && 'bg-primary-soft/60')}>
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.delivery?.map((d) => (
                <span key={d} className="shrink-0 text-xs text-muted">
                  {d === 'live' ? 'Live' : 'Recorded'}
                </span>
              ))}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
        On sale
      </label>
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={save.isPending} disabled={!ok}>
          Save bundle
        </Button>
      </div>
    </form>
  )
}

export function ConsoleBundlesPage() {
  const q = useConsoleBundles()
  const [editing, setEditing] = useState<ConsoleBundle | 'new' | null>(null)
  useEffect(() => {
    document.title = 'Bundles · Console'
  }, [])
  return (
    <>
      <PageHeader
        title="Bundles"
        description="Group courses and set one seat price. Companies split the seats between the courses however they like."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New bundle
          </Button>
        }
      />
      {q.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : q.error ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<Layers />} title="No bundles yet" body="Make the first one: pick two or more courses and a seat price." />
      ) : (
        <div className="stagger grid gap-4 animate-reveal md:grid-cols-2">
          {q.data.map((b) => (
            <Card key={b.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{b.title}</h3>
                  {b.description ? <p className="mt-1 line-clamp-2 text-sm text-muted">{b.description}</p> : null}
                </div>
                <Badge tone={b.is_active ? 'success' : 'neutral'}>{b.is_active ? 'On sale' : 'Hidden'}</Badge>
              </div>
              <ul className="grid gap-1 text-sm">
                {b.courses.map((c) => (
                  <li key={c.course_id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{c.title}</span>
                    {!c.seats_on_sale ? <span className="shrink-0 text-xs text-warning">No recorded price: seats can't be sold</span> : null}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between">
                <p className="text-sm">
                  <span className="text-lg font-semibold">{gbp(b.seat_price_minor)}</span> <span className="text-muted">per seat</span>
                </p>
                <Button variant="secondary" size="sm" onClick={() => setEditing(b)}>
                  <Pencil /> Edit
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null ? (
          <DialogContent title={editing === 'new' ? 'New bundle' : `Edit: ${editing.title}`} className="max-w-xl">
            <Editor bundle={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}
