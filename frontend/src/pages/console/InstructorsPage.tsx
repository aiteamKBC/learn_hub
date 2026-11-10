import { BookOpen, Check, Coins, Download, GraduationCap, Inbox, MailPlus, MoreHorizontal, Pause, Pencil, Percent, Play, Search, Send, ShieldCheck, Wallet, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BarList } from '@/features/console/charts'
import { useSetInstructorKeeps } from '@/features/console/commissions'
import { day, SearchBox, Toolbar } from '@/features/console/money-ui'
import {
  fetchInstructorsExport,
  type InstructorDetail,
  type InstructorFilters,
  type InstructorPermissions,
  type InstructorRow,
  saveCsv,
  useApplications,
  useDecideApplication,
  useEditInstructor,
  useInstructor,
  useInstructorKpis,
  useCancelInvite,
  useInstructors,
  useInviteInstructor,
  usePendingInvites,
  useReactivateInstructor,
  useResendInvite,
  useSetPermissions,
  useSuspendInstructor,
} from '@/features/console/people'
import { PeopleSwitch, PersonCell, personStatus } from '@/features/console/people-ui'
import { METHOD_NAME, REQUEST_STATUS } from '@/features/console/payouts'
import { ConfirmDialog, DetailSheet, gbp, InfoRow, LoadMore, StatusPill, useParam, useTabParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { Link } from '@/lib/router'

type Pending = { kind: 'suspend' | 'reactivate' | 'edit'; id: string; name: string } | null

// ---------------------------------------------------------------- KPIs
function Kpis() {
  const q = useInstructorKpis()
  const d = q.data
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  return (
    <section aria-label="Instructor figures" className={d ? 'stagger grid grid-cols-2 gap-4 xl:grid-cols-4' : 'grid grid-cols-2 gap-4 xl:grid-cols-4'}>
      {!d ? (
        Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)
      ) : (
        <>
          <StatCard label="Total instructors" value={d.total} icon={<GraduationCap />} hint={d.pending_applications ? `${d.pending_applications} applications waiting` : 'approved or suspended'} />
          <StatCard label="Active instructors" value={d.active} icon={<Check />} tone="success" hint="can use the studio" />
          <StatCard label="Suspended" value={d.suspended} icon={<Pause />} tone="danger" hint="courses stay live" />
          <StatCard label="Total earnings (all time)" value={<CountUp value={d.total_earnings_gbp_minor} format={gbp} />} icon={<Coins />} tone="info" hint="instructors' share of sales" />
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- dialogs
function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invite = useInviteInstructor()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add instructor" description="We email them a link (valid for 7 days). They become an instructor when they accept it.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate(
              { email: email.trim(), name: name.trim() },
              {
                onSuccess: (r) => (toast.success(`Invitation sent to ${r.email}`), onOpenChange(false), setEmail(''), setName('')),
                onError: (err) => toast.error((err as Error).message),
              },
            )
          }}
        >
          <Field label="Name" hint="Used in the greeting (optional).">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off" />}</Field>
          <Field label="Email">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoComplete="off" />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              <MailPlus /> Send invitation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditInstructorDialog({ d, open, onOpenChange }: { d: InstructorDetail | undefined; open: boolean; onOpenChange: (o: boolean) => void }) {
  const edit = useEditInstructor()
  const [form, setForm] = useState({ full_name: '', headline: '', bio: '', website_url: '' })
  const [key, setKey] = useState('')
  if (open && d && key !== d.user_id) {
    setKey(d.user_id)
    setForm({ full_name: d.name, headline: d.headline, bio: d.bio, website_url: d.website_url })
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o || setKey(''))}>
      <DialogContent title="Edit instructor" description="What learners see on the instructor's public profile.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            edit.mutate({ id: d!.user_id, body: form }, { onSuccess: () => (toast.success('Instructor saved'), onOpenChange(false), setKey('')), onError: (err) => toast.error((err as Error).message) })
          }}
        >
          <Field label="Full name">{(p) => <Input {...p} value={form.full_name} onChange={set('full_name')} required maxLength={200} />}</Field>
          <Field label="Headline">{(p) => <Input {...p} value={form.headline} onChange={set('headline')} maxLength={160} />}</Field>
          <Field label="Bio">{(p) => <Textarea {...p} value={form.bio} onChange={set('bio')} maxLength={5000} rows={5} />}</Field>
          <Field label="Website" hint="An https:// link.">{(p) => <Input {...p} type="url" value={form.website_url} onChange={set('website_url')} maxLength={500} placeholder="https://" />}</Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={edit.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- detail panel
const PERMS: { key: keyof Omit<InstructorPermissions, 'max_courses'>; label: string; hint: string }[] = [
  { key: 'can_publish_without_review', label: 'Publish without review', hint: 'New versions go live without staff approval.' },
  { key: 'can_create_coupons', label: 'Create coupons', hint: 'Discount codes for their own courses.' },
  { key: 'can_use_drm', label: 'Use protected video (DRM)', hint: 'Uploads go to the protected video library.' },
  { key: 'can_issue_certificates', label: 'Issue certificates', hint: 'Learners get a certificate when they finish.' },
]

function PermissionsForm({ d }: { d: InstructorDetail }) {
  const save = useSetPermissions()
  const [p, setP] = useState<InstructorPermissions>({ ...d.permissions })
  const [limit, setLimit] = useState(d.permissions.max_courses?.toString() ?? '')
  const dirty = PERMS.some((x) => p[x.key] !== d.permissions[x.key]) || limit !== (d.permissions.max_courses?.toString() ?? '')
  return (
    <form
      className="grid gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        const max = limit.trim() === '' ? null : Number(limit)
        if (max !== null && (!Number.isInteger(max) || max < 0)) return toast.error('The course limit must be a whole number.')
        save.mutate({ id: d.user_id, body: { ...p, max_courses: max } }, { onSuccess: () => toast.success('Permissions saved. The instructor was told.'), onError: (err) => toast.error((err as Error).message) })
      }}
    >
      {PERMS.map((x) => (
        <div key={x.key} className="flex items-center justify-between gap-4 border-b border-border py-3">
          <div className="min-w-0">
            <Label htmlFor={`perm-${x.key}`}>{x.label}</Label>
            <p className="text-xs text-muted">{x.hint}</p>
          </div>
          <Switch id={`perm-${x.key}`} checked={!!p[x.key]} onCheckedChange={(v) => setP((s) => ({ ...s, [x.key]: v }))} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <Label htmlFor="perm-max">Course limit</Label>
          <p className="text-xs text-muted">Leave empty to use the platform setting.</p>
        </div>
        <Input id="perm-max" inputMode="numeric" className="w-24 text-right" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} placeholder="None" />
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
          <ShieldCheck /> Save permissions
        </Button>
      </div>
    </form>
  )
}

function CommissionEditor({ d }: { d: InstructorDetail }) {
  const save = useSetInstructorKeeps()
  const [value, setValue] = useState(String(d.keeps_pct))
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(value)
        if (!(n >= 0 && n <= 100)) return toast.error('Enter a rate between 0% and 100%.')
        save.mutate({ id: d.user_id, keeps_pct: n }, { onSuccess: () => toast.success('Commission saved. It applies to sales from now on.'), onError: (err) => toast.error((err as Error).message) })
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="keeps">Instructor keeps (%)</Label>
        <Input id="keeps" inputMode="decimal" className="w-28" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={save.isPending}>
        Save rate
      </Button>
      {d.fee_is_custom ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => save.mutate({ id: d.user_id, keeps_pct: null }, { onSuccess: () => (setValue(String(d.default_keeps_pct)), toast.success('Back to the platform default')) })}
        >
          Use default ({d.default_keeps_pct}%)
        </Button>
      ) : null}
    </form>
  )
}

function InstructorPanel({ id, onAction }: { id: string; onAction: (p: Pending) => void }) {
  const q = useInstructor(id)
  const d = q.data
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!d) return <Skeleton className="h-72" />
  return (
    <div className="animate-reveal grid gap-5">
      <div className="flex items-center gap-3">
        <PersonCell name={d.name} email={d.email} />
        <span className="ml-auto">
          <StatusPill status={d.status} label={personStatus(d.status)} />
        </span>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Instructor details">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="courses">Courses ({d.courses})</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          <div>
            <InfoRow label="Total courses">{d.courses}</InfoRow>
            <InfoRow label="Total students">{d.students.toLocaleString('en-GB')}</InfoRow>
            <InfoRow label="Total earnings (all time)">{gbp(d.earnings_gbp_minor)}</InfoRow>
            <InfoRow label="Commission rate">
              {d.keeps_pct}% {d.fee_is_custom ? <Badge tone="info">Own rate</Badge> : <Badge tone="neutral">Default</Badge>}
            </InfoRow>
            <InfoRow label="Applied">{day(d.applied_at)}</InfoRow>
            {d.approved_at ? <InfoRow label="Approved">{day(d.approved_at)}</InfoRow> : null}
            {d.headline ? <InfoRow label="Headline">{d.headline}</InfoRow> : null}
          </div>
          <CommissionEditor d={d} />
          {d.rules.length ? (
            <div className="rounded-lg bg-info-soft p-3 text-xs text-info">
              Commission rules take priority:{' '}
              {d.rules.map((r) => `${r.name} (${r.target}, ${r.keeps_pct}%)`).join('; ')}.{' '}
              <Link to="/console/commissions?tab=rules" className="font-medium underline">
                Manage rules
              </Link>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="courses">
          {d.course_list.length === 0 ? (
            <EmptyState icon={<BookOpen />} title="No courses yet" className="py-6" />
          ) : (
            <ul className="stagger grid gap-2">
              {d.course_list.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/console/courses?course=${c.id}`} className="min-w-0 truncate font-medium hover:text-primary">
                      {c.title}
                    </Link>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>{c.students.toLocaleString('en-GB')} students</span>
                    {c.rating_count ? <Rating value={c.rating_avg} count={c.rating_count} /> : <span>No ratings</span>}
                    <span>Earned {gbp(c.earned_gbp_minor)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsForm key={JSON.stringify(d.permissions)} d={d} />
        </TabsContent>
        <TabsContent value="earnings" className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Available', d.balance.available],
              ['In the hold', d.balance.pending],
              ['Being paid', d.balance.in_payout],
              ['Paid out', d.balance.paid],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 font-semibold tabular">
                  <CountUp value={v as number} format={gbp} />
                </p>
              </div>
            ))}
          </div>
          {d.by_month.length ? (
            <BarList rows={d.by_month.map((m) => ({ label: new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), value: m.amount }))} format={gbp} />
          ) : (
            <EmptyState icon={<Coins />} title="No earnings in the last year" className="py-6" />
          )}
        </TabsContent>
        <TabsContent value="payouts" className="grid gap-3">
          <p className="text-sm text-muted">
            Payout method: {d.payout_method ? METHOD_NAME[d.payout_method] : 'not set'}
            {d.payout_method ? (d.payout_verified ? ' · checked' : ' · waiting to be checked') : ''}
          </p>
          {d.payouts.length === 0 ? (
            <EmptyState icon={<Wallet />} title="No payouts yet" className="py-6" />
          ) : (
            <ul className="stagger grid gap-2">
              {d.payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                  <div className="min-w-0">
                    <Link to={p.kind === 'request' ? `/console/payouts?tab=requests&request=${p.id}` : '/console/payouts?tab=history'} className="font-medium hover:text-primary">
                      {p.reference}
                    </Link>
                    <p className="text-xs text-muted">
                      {day(p.at)} · {METHOD_NAME[p.method] ?? p.method}
                      {p.reason ? ` · ${p.reason}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular">{gbp(p.amount_gbp_minor)}</p>
                    <StatusPill status={p.status} label={REQUEST_STATUS[p.status]} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <Pencil /> Edit instructor
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setTab('permissions')}>
          <ShieldCheck /> Set permissions
        </Button>
        {d.status === 'approved' ? (
          <Button variant="danger" size="sm" onClick={() => onAction({ kind: 'suspend', id: d.user_id, name: d.name })}>
            <Pause /> Suspend
          </Button>
        ) : d.status === 'suspended' ? (
          <Button variant="secondary" size="sm" onClick={() => onAction({ kind: 'reactivate', id: d.user_id, name: d.name })}>
            <Play /> Reactivate
          </Button>
        ) : null}
      </div>
      <EditInstructorDialog d={d} open={editing} onOpenChange={setEditing} />
    </div>
  )
}

// ---------------------------------------------------------------- applications
function Applications() {
  const q = useApplications()
  const decide = useDecideApplication()
  const [rejecting, setRejecting] = useState<{ id: string; name: string } | null>(null)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-40" />
  if (q.data.length === 0) return <EmptyState icon={<Inbox />} title="No applications waiting" body="New applications to teach appear here." />
  return (
    <>
      <ul className="stagger grid gap-3 p-3 sm:p-4">
        {q.data.map((a) => (
          <li key={a.user_id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <PersonCell name={a.name} email={a.email} />
              <p className="text-xs text-muted">Applied {day(a.applied_at)}</p>
            </div>
            {a.headline ? <p className="mt-3 text-sm font-medium">{a.headline}</p> : null}
            {a.bio ? <p className="mt-1 line-clamp-3 text-sm text-muted">{a.bio}</p> : null}
            {a.website_url ? (
              <a href={a.website_url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-sm text-primary hover:underline">
                {a.website_url}
              </a>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={decide.isPending && decide.variables?.id === a.user_id && decide.variables.approve}
                onClick={() => decide.mutate({ id: a.user_id, approve: true }, { onSuccess: () => toast.success(`${a.name || a.email} can now teach`), onError: (e) => toast.error((e as Error).message) })}
              >
                <Check /> Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting({ id: a.user_id, name: a.name || a.email })}>
                <X /> Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting?.name ?? ''}?`}
        body="They get your reason by email and can apply again."
        confirmLabel="Reject application"
        reason="required"
        reasonLabel="What should they change?"
        loading={decide.isPending}
        onConfirm={(reason) =>
          decide.mutate({ id: rejecting!.id, approve: false, reason }, { onSuccess: () => (toast.success('Application rejected'), setRejecting(null)), onError: (e) => toast.error((e as Error).message) })
        }
      />
    </>
  )
}

// ---------------------------------------------------------------- page
function RowMenu({ r, onOpen, onAction }: { r: InstructorRow; onOpen: () => void; onAction: (p: Pending) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name || r.email}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent onClick={(e) => e.stopPropagation()}>
        <MenuItem onSelect={onOpen}>
          <ShieldCheck /> Details and permissions
        </MenuItem>
        {r.status === 'approved' ? (
          <MenuItem onSelect={() => onAction({ kind: 'suspend', id: r.user_id, name: r.name })}>
            <Pause /> Suspend
          </MenuItem>
        ) : r.status === 'suspended' ? (
          <MenuItem onSelect={() => onAction({ kind: 'reactivate', id: r.user_id, name: r.name })}>
            <Play /> Reactivate
          </MenuItem>
        ) : null}
      </MenuContent>
    </Menu>
  )
}

function Invitations({ onInvite }: { onInvite: () => void }) {
  const q = usePendingInvites()
  const resend = useResendInvite()
  const cancel = useCancelInvite()
  const [cancelling, setCancelling] = useState<{ id: string; email: string } | null>(null)
  if (q.error) return <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="m-4 h-40" />
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={<MailPlus />}
        title="No invitations waiting"
        body="People you invite to teach appear here until they accept."
        action={
          <Button size="sm" onClick={onInvite}>
            <MailPlus /> Add instructor
          </Button>
        }
      />
    )
  return (
    <>
      <ul className="stagger grid gap-3 p-3 sm:p-4">
        {q.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div className="min-w-0">
              <PersonCell name={i.name} email={i.email} />
              <p className="mt-2 text-xs text-muted">
                Sent {day(i.sent_at)}
                {i.invited_by ? ` by ${i.invited_by}` : ''}
                {i.send_count > 1 ? ` · sent ${i.send_count} times` : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {i.expired ? <Badge tone="danger">Expired</Badge> : <Badge tone="info">Expires {day(i.expires_at)}</Badge>}
              <Button
                size="sm"
                variant="secondary"
                loading={resend.isPending && resend.variables === i.id}
                onClick={() => resend.mutate(i.id, { onSuccess: () => toast.success(`Invitation sent again to ${i.email}`), onError: (e) => toast.error((e as Error).message) })}
              >
                <Send /> Resend
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelling({ id: i.id, email: i.email })}>
                <X /> Cancel
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel the invitation to ${cancelling?.email ?? ''}?`}
        body="The link in their email stops working. You can invite them again later."
        confirmLabel="Cancel invitation"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(cancelling!.id, { onSuccess: () => (toast.success('Invitation cancelled'), setCancelling(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </>
  )
}

const TABS = ['all', 'applications', 'invitations'] as const

export function ConsoleInstructorsPage() {
  const [tab, setTab] = useTabParam(TABS, 'all')
  const [userId, setUserId] = useParam('user')
  const [qText, setQText] = useState('')
  const q = useDebounced(qText.trim())
  const [status, setStatus] = useState('')
  const [permission, setPermission] = useState<InstructorFilters['permission']>('')
  const filters: InstructorFilters = { q, status, permission }
  const list = useInstructors(filters)
  const apps = useApplications()
  const invitesQ = usePendingInvites()
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const [pending, setPending] = useState<Pending>(null)
  const [inviting, setInviting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const suspend = useSuspendInstructor()
  const reactivate = useReactivateInstructor()
  const filtered = !!(q || status || permission)

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await fetchInstructorsExport(filters)
      saveCsv(
        'instructors.csv',
        ['Name', 'Email', 'Status', 'Courses', 'Students', 'Earnings (GBP)', 'Keeps %', 'Own rate', 'Applied', 'Approved'],
        all.map((r) => [r.name, r.email, personStatus(r.status), r.courses, r.students, (r.earnings_gbp_minor / 100).toFixed(2), r.keeps_pct, r.fee_is_custom ? 'Yes' : 'No', r.applied_at.slice(0, 10), r.approved_at?.slice(0, 10) ?? '']),
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PageHeader title="Instructor management" description="Manage instructors, their permissions, courses, commission rates and payouts." actions={<PeopleSwitch active="instructors" />} />
      <div className="grid gap-6">
        <Kpis />
        <Card>
          <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
            <div className="px-5 pt-3">
              <TabsList aria-label="Instructor lists">
                <TabsTrigger value="all">
                  <GraduationCap /> All instructors
                </TabsTrigger>
                <TabsTrigger value="applications">
                  <Inbox /> Applications
                  {apps.data?.length ? <Badge tone="warning">{apps.data.length}</Badge> : null}
                </TabsTrigger>
                <TabsTrigger value="invitations">
                  <MailPlus /> Invitations
                  {invitesQ.data?.length ? <Badge tone="neutral">{invitesQ.data.length}</Badge> : null}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="all" className="pt-0">
              <Toolbar>
                <SearchBox value={qText} onChange={setQText} label="Search instructors" placeholder="Search instructors by name or email" className="sm:max-w-xs" />
                <NativeSelect aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                  <option value="">All statuses</option>
                  <option value="approved">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="pending">Applied</option>
                  <option value="rejected">Rejected</option>
                </NativeSelect>
                <NativeSelect aria-label="Filter by permission" value={permission} onChange={(e) => setPermission(e.target.value as InstructorFilters['permission'])} className="w-auto">
                  <option value="">All permissions</option>
                  <option value="publish_without_review">Publish without review</option>
                  <option value="no_coupons">Coupons off</option>
                  <option value="drm">Protected video (DRM)</option>
                  <option value="course_limit">Has a course limit</option>
                  <option value="custom">Any custom permission</option>
                </NativeSelect>
                <div className="flex flex-wrap gap-2 sm:ml-auto">
                  <Button onClick={() => setInviting(true)}>
                    <MailPlus /> Add instructor
                  </Button>
                  <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
                    {exporting ? null : <Download />} Export
                  </Button>
                </div>
              </Toolbar>
              {list.error ? (
                <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
              ) : list.isLoading ? (
                <div className="grid gap-3 p-4">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={filtered ? <Search /> : <GraduationCap />}
                  title={filtered ? 'Nobody matches' : 'No instructors yet'}
                  body={filtered ? 'Try another name or clear the filters.' : 'Approve an application or invite someone to teach.'}
                  action={
                    filtered ? (
                      <Button variant="secondary" onClick={() => (setQText(''), setStatus(''), setPermission(''))}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button onClick={() => setInviting(true)}>
                        <MailPlus /> Add instructor
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="animate-reveal">
                  <ul className="stagger grid gap-3 p-3 md:hidden">
                    {rows.map((r) => (
                      <li key={r.user_id}>
                        <button type="button" onClick={() => setUserId(r.user_id)} className="w-full rounded-lg border border-border bg-surface p-3.5 text-left shadow-sm transition-colors hover:border-border-strong">
                          <div className="flex items-start justify-between gap-3">
                            <PersonCell name={r.name} email={r.email} />
                            <StatusPill status={r.status} label={personStatus(r.status)} />
                          </div>
                          <p className="mt-3 text-xs text-muted">
                            {r.courses} courses · {r.students.toLocaleString('en-GB')} students · {gbp(r.earnings_gbp_minor)} · keeps {r.keeps_pct}%
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden md:block">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Instructor</Th>
                          <Th className="text-right">Courses</Th>
                          <Th className="text-right">Students</Th>
                          <Th className="text-right">Earnings (all time)</Th>
                          <Th className="text-right">Commission</Th>
                          <Th>Status</Th>
                          <Th className="text-right">
                            <span className="sr-only">Actions</span>
                          </Th>
                        </tr>
                      </thead>
                      <tbody className="stagger">
                        {rows.map((r) => (
                          <Tr key={r.user_id} className="cursor-pointer" onClick={() => setUserId(r.user_id)}>
                            <Td>
                              <button type="button" className="text-left" onClick={(e) => (e.stopPropagation(), setUserId(r.user_id))}>
                                <PersonCell name={r.name} email={r.email} />
                              </button>
                            </Td>
                            <Td className="text-right tabular">{r.courses}</Td>
                            <Td className="text-right tabular">{r.students.toLocaleString('en-GB')}</Td>
                            <Td className="text-right tabular">{gbp(r.earnings_gbp_minor)}</Td>
                            <Td className="text-right tabular">
                              <span className="inline-flex items-center gap-1">
                                {r.keeps_pct}%{r.fee_is_custom ? <Percent className="size-3 text-info" aria-label="own rate" /> : null}
                              </span>
                            </Td>
                            <Td>
                              <StatusPill status={r.status} label={personStatus(r.status)} />
                            </Td>
                            <Td className="text-right">
                              <RowMenu r={r} onOpen={() => setUserId(r.user_id)} onAction={setPending} />
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                  <LoadMore shown={rows.length} noun={rows.length === 1 ? 'instructor' : 'instructors'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
                </div>
              )}
            </TabsContent>
            <TabsContent value="applications" className="pt-0">
              <Applications />
            </TabsContent>
            <TabsContent value="invitations" className="pt-0">
              <Invitations onInvite={() => setInviting(true)} />
            </TabsContent>
          </Tabs>
        </Card>
        <Card>
          <CardHeader title="How instructor accounts work" />
          <CardBody>
            <ul className="grid gap-2 text-sm text-muted sm:grid-cols-3">
              <li>Suspending stops studio access. Their courses stay on sale and learners keep them.</li>
              <li>Permissions are checked by the studio itself, not only shown here.</li>
              <li>A commission change applies to sales from now on. Past earnings never change.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
      <DetailSheet open={!!userId} onOpenChange={(o) => !o && setUserId('')} title="Instructor details">
        {userId ? <InstructorPanel id={userId} onAction={setPending} /> : null}
      </DetailSheet>
      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <ConfirmDialog
        open={pending?.kind === 'suspend'}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Suspend ${pending?.name ?? 'this instructor'}?`}
        body="Studio access stops at once. Their courses stay live and learners keep access. They get your reason."
        confirmLabel="Suspend instructor"
        reason="required"
        loading={suspend.isPending}
        onConfirm={(reason) => suspend.mutate({ id: pending!.id, reason }, { onSuccess: () => (toast.success('Instructor suspended'), setPending(null)), onError: (e) => toast.error((e as Error).message) })}
      />
      <ConfirmDialog
        open={pending?.kind === 'reactivate'}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Reactivate ${pending?.name ?? 'this instructor'}?`}
        body="They can use the studio again straight away."
        confirmLabel="Reactivate"
        tone="primary"
        loading={reactivate.isPending}
        onConfirm={() => reactivate.mutate(pending!.id, { onSuccess: () => (toast.success('Instructor reactivated'), setPending(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </>
  )
}
