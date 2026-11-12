import { Package, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import {
  type PackageBody,
  useAdminPackages,
  useCreatePackage,
  useDeletePackage,
  usePriceTiers,
  useTokenCourses,
  useUpdatePackage,
} from '@/features/b2c/console'

type Pkg = NonNullable<ReturnType<typeof useAdminPackages>['data']>[number]

/** Console > Packages. Staff create and manage the B2C course bundles sold on /packages:
 * a set of courses for one cash price (via a price tier). Deactivating keeps buyers' access. */
export function AdminPackagesPage() {
  const list = useAdminPackages()
  const del = useDeletePackage()
  const reactivate = useUpdatePackage()
  const [edit, setEdit] = useState<Pkg | null>(null)
  const [open, setOpen] = useState(false)

  const start = (p: Pkg | null) => { setEdit(p); setOpen(true) }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Course packages"
        description="Bundle several courses for one price. Learners buy them on the Packages page."
      />
      <Card>
        <CardHeader
          title="Packages"
          action={<Button size="sm" onClick={() => start(null)}><Plus /> New package</Button>}
        />
        {list.isLoading ? (
          <Skeleton className="m-4 h-48 rounded-lg" />
        ) : list.error ? (
          <ErrorState message="We couldn't load packages." onRetry={() => void list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState className="m-4" icon={<Package />} title="No packages yet" body="Create a bundle of courses to sell for one price." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Price</Th>
                  <Th>Saving</Th>
                  <Th>Courses</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </thead>
              <tbody>
                {list.data.map((p) => {
                  const save = p.courses_cash_total_minor - p.price_gbp_minor
                  const savePct = p.courses_cash_total_minor > 0 ? Math.round((save / p.courses_cash_total_minor) * 100) : 0
                  return (
                    <Tr key={p.id}>
                      <Td className="font-medium">{p.name}</Td>
                      <Td className="tabular-nums">£{(p.price_gbp_minor / 100).toFixed(2)}</Td>
                      <Td className="tabular-nums">
                        {save > 0 ? <Badge tone="success">Save {savePct}%</Badge> : <span className="text-muted">—</span>}
                      </Td>
                      <Td className="tabular-nums">{p.course_count}</Td>
                      <Td><Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'Active' : 'Inactive'}</Badge></Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => start(p)}><Pencil /> Edit</Button>
                          {p.is_active ? (
                            <Button size="sm" variant="ghost" loading={del.isPending} onClick={() => del.mutate(p.id, { onSuccess: () => toast.success('Package deactivated.'), onError: (e) => toast.error((e as Error).message) })}>
                              <Trash2 /> Deactivate
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" loading={reactivate.isPending} onClick={() => reactivate.mutate({ packageId: p.id, body: { is_active: true } }, { onSuccess: () => toast.success('Package reactivated.'), onError: (e) => toast.error((e as Error).message) })}>
                              Reactivate
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <PackageDialog open={open} onOpenChange={setOpen} pkg={edit} />
    </div>
  )
}

function PackageDialog({ open, onOpenChange, pkg }: { open: boolean; onOpenChange: (v: boolean) => void; pkg: Pkg | null }) {
  // Remount on target change so the form resets to the package being edited.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" title={pkg ? 'Edit package' : 'New package'}>
        {open ? <PackageForm key={pkg?.id ?? 'new'} pkg={pkg} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function PackageForm({ pkg, onDone }: { pkg: Pkg | null; onDone: () => void }) {
  const tiers = usePriceTiers()
  const [search, setSearch] = useState('')
  const courses = useTokenCourses(search)
  const create = useCreatePackage()
  const update = useUpdatePackage()

  const [name, setName] = useState(pkg?.name ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [tierId, setTierId] = useState(pkg?.price_tier_id ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set(pkg?.courses.map((c) => c.id) ?? []))

  // Keep already-picked courses visible even when they are not in the current search page.
  const pickedTitles = useMemo(() => new Map(pkg?.courses.map((c) => [c.id, c.title]) ?? []), [pkg])

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const valid = name.trim().length >= 2 && tierId && picked.size > 0
  const saving = create.isPending || update.isPending

  const submit = () => {
    if (!valid) return toast.error('Give it a name, a price and at least one course.')
    const course_ids = [...picked]
    const done = { onSuccess: () => { toast.success(pkg ? 'Package updated.' : 'Package created.'); onDone() }, onError: (e: unknown) => toast.error((e as Error).message) }
    if (pkg) {
      update.mutate({ packageId: pkg.id, body: { name: name.trim(), description: description.trim(), price_tier_id: tierId, course_ids } }, done)
    } else {
      create.mutate({ name: name.trim(), description: description.trim(), price_tier_id: tierId, course_ids } as PackageBody, done)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Name">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Care Essentials bundle" />}
      </Field>
      <Field label="Description" hint="Shown on the package card.">
        {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What's in it and who it's for." />}
      </Field>
      <Field label="Price">
        {(p) => (
          <NativeSelect {...p} value={tierId} onChange={(e) => setTierId(e.target.value)}>
            <option value="">Choose a price…</option>
            {tiers.data?.map((t) => <option key={t.id} value={t.id}>£{(t.gbp_minor / 100).toFixed(2)} — {t.name}</option>)}
          </NativeSelect>
        )}
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium">Courses in this package <span className="text-muted">({picked.size} selected)</span></p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses to add…" className="pl-9" aria-label="Search courses" />
        </div>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
          {courses.isLoading ? (
            <Skeleton className="m-3 h-32 rounded-md" />
          ) : (
            <ul className="divide-y divide-border">
              {courses.data?.items.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span>{c.title}</span>
                  </label>
                </li>
              ))}
              {/* already-picked courses not in the current search results */}
              {[...picked].filter((id) => !courses.data?.items.some((c) => c.id === id) && pickedTitles.has(id)).map((id) => (
                <li key={id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                    <Checkbox checked onCheckedChange={() => toggle(id)} />
                    <span>{pickedTitles.get(id)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
        <Button disabled={!valid} loading={saving} onClick={submit}>{pkg ? 'Save changes' : 'Create package'}</Button>
      </div>
    </div>
  )
}
