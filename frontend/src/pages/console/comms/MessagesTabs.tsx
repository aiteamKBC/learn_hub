import { Bell, BellRing, Eye, Mail, Megaphone, RotateCcw, Save, Search, Send, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { AUDIENCES, type BroadcastInput, type ConsoleBroadcast, type ConsoleTemplate, useAudienceCount, useBroadcastCompanies, useBroadcasts, useEndBanner, useNotificationLog, useNotificationStats, usePreviewTemplate, useSaveTemplate, useSendBroadcast, useTemplates } from '@/features/console/comms'
import { ConfirmDialog, LoadMore, StatusPill } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'

// ---------------------------------------------------------------- composer (broadcasts and announcements)
function Composer({ kind }: { kind: 'broadcast' | 'announcement' }) {
  const send = useSendBroadcast()
  const blank: BroadcastInput = { kind, title: '', body: '', audience: 'learners', org_id: null, send_in_app: true, send_email: false, url: '', show_as_banner: kind === 'announcement', banner_starts_at: null, banner_ends_at: null }
  const [v, setV] = useState<BroadcastInput>(blank)
  const [confirm, setConfirm] = useState(false)
  const companies = useBroadcastCompanies(v.audience === 'company')
  const count = useAudienceCount(v.audience, v.org_id ?? undefined)
  const reaches = v.send_in_app || v.send_email
  const ready = v.title.trim() && v.body.trim() && (reaches || v.show_as_banner) && (v.audience !== 'company' || v.org_id)
  const toIso = (d: string) => (d ? new Date(d).toISOString() : null)

  return (
    <Card>
      <CardHeader title={kind === 'announcement' ? 'New announcement' : 'Send a notification'} description={kind === 'announcement' ? 'A platform announcement, with an optional banner across the site between two dates.' : 'One message to many people, in their notifications and/or by email.'} />
      <CardBody>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) setConfirm(true)
          }}
        >
          <Field label="Title">{(p) => <Input {...p} required maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
          <Field label="Message">{(p) => <Textarea {...p} required maxLength={5000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-28" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Who receives it">
              {(p) => (
                <NativeSelect {...p} value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value, org_id: null })}>
                  {Object.entries(AUDIENCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
            {v.audience === 'company' ? (
              <Field label="Company">
                {(p) => (
                  <NativeSelect {...p} required value={v.org_id ?? ''} onChange={(e) => setV({ ...v, org_id: e.target.value || null })}>
                    <option value="">Choose a company</option>
                    {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
            ) : (
              <Field label="Link (optional)" hint="A page on the platform, e.g. /courses">
                {(p) => <Input {...p} value={v.url} placeholder="/courses" onChange={(e) => setV({ ...v, url: e.target.value })} />}
              </Field>
            )}
          </div>
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span><span className="font-medium">In the app</span><span className="block text-xs text-muted">Shows in the notification bell</span></span>
              <Switch checked={v.send_in_app} onCheckedChange={(c) => setV({ ...v, send_in_app: c })} aria-label="Send in the app" />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span><span className="font-medium">By email</span><span className="block text-xs text-muted">People who turned these emails off are skipped</span></span>
              <Switch checked={v.send_email} onCheckedChange={(c) => setV({ ...v, send_email: c })} aria-label="Send by email" />
            </label>
            {kind === 'announcement' ? (
              <>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span><span className="font-medium">Site banner</span><span className="block text-xs text-muted">Across the top of every page</span></span>
                  <Switch checked={!!v.show_as_banner} onCheckedChange={(c) => setV({ ...v, show_as_banner: c })} aria-label="Show as a site banner" />
                </label>
                {v.show_as_banner ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Banner from" hint="Empty: now">{(p) => <Input {...p} type="datetime-local" onChange={(e) => setV({ ...v, banner_starts_at: toIso(e.target.value) })} />}</Field>
                    <Field label="Banner until" hint="Empty: until you end it">{(p) => <Input {...p} type="datetime-local" onChange={(e) => setV({ ...v, banner_ends_at: toIso(e.target.value) })} />}</Field>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {/* preview: how it looks in the notification list */}
          <div className="rounded-lg border border-dashed border-border-strong bg-surface-2/50 p-3" aria-label="Preview">
            <p className="text-[11px] font-medium tracking-wider text-subtle uppercase">Preview</p>
            <div className="mt-2 flex gap-3 rounded-md bg-surface p-3 shadow-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><BellRing className="size-4" /></span>
              <div className="min-w-0 text-sm">
                <p className="font-medium">{v.title || 'Your title'}</p>
                <p className="line-clamp-3 text-muted">{v.body || 'Your message'}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted" aria-live="polite">
              <Users className="mr-1 inline size-4" />
              {count.data ? `${count.data.count.toLocaleString('en-GB')} people` : '…'}
            </span>
            <Button type="submit" className="ml-auto" disabled={!ready}>
              <Send /> {kind === 'announcement' ? 'Publish' : 'Send'}
            </Button>
          </div>
        </form>
      </CardBody>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        tone="primary"
        title={kind === 'announcement' ? 'Publish this announcement?' : 'Send this notification?'}
        body={
          reaches
            ? `It goes to ${count.data?.count.toLocaleString('en-GB') ?? '…'} people (${AUDIENCES[v.audience]?.toLowerCase()})${v.send_email ? ', including by email' : ''}. This can't be undone.`
            : 'It shows as a site banner only.'
        }
        confirmLabel={kind === 'announcement' ? 'Publish' : 'Send now'}
        loading={send.isPending}
        onConfirm={() =>
          send.mutate(v, {
            onSuccess: (b) => {
              toast.success(`Sent to ${b.recipient_count.toLocaleString('en-GB')} people`)
              setConfirm(false)
              setV(blank)
            },
            onError: (e) => toast.error(e.message),
          })
        }
      />
    </Card>
  )
}

function BroadcastList({ kind }: { kind: 'broadcast' | 'announcement' }) {
  const { data, isLoading, error, refetch } = useBroadcasts(kind)
  const end = useEndBanner()
  const [ending, setEnding] = useState<ConsoleBroadcast | null>(null)
  return (
    <Card className="min-w-0">
      <CardHeader title={kind === 'announcement' ? 'Announcements' : 'Sent broadcasts'} />
      {error ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-3 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon={kind === 'announcement' ? <Megaphone /> : <Send />} title={kind === 'announcement' ? 'No announcements yet' : 'Nothing sent yet'} body="What you send appears here with how many people it reached." />
      ) : (
        <ul className="stagger grid divide-y divide-border">
          {data.map((b) => (
            <li key={b.id} className="grid gap-1 px-5 py-3.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{b.title}</span>
                {b.banner_live ? <StatusPill status="live" label="Banner showing" /> : b.show_as_banner ? <StatusPill status="ended" label="Banner ended" /> : null}
                <span className="ml-auto text-xs text-muted">{b.sent_at ? relativeDate(b.sent_at) : ''}</span>
              </div>
              <p className="line-clamp-2 text-muted">{b.body}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{b.company ?? AUDIENCES[b.audience]}</span>
                <span className="tabular">{b.recipient_count.toLocaleString('en-GB')} people</span>
                {b.send_in_app ? <span className="tabular">{b.read_count.toLocaleString('en-GB')} read</span> : null}
                {b.send_email ? <span className="inline-flex items-center gap-1"><Mail className="size-3" /> email</span> : null}
                <span>by {b.sent_by}</span>
                {b.banner_live ? (
                  <Button variant="link" size="sm" className="ml-auto text-danger" onClick={() => setEnding(b)}>
                    End banner
                  </Button>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(o) => !o && setEnding(null)}
        title="End this banner now?"
        body="It disappears from every page straight away."
        confirmLabel="End banner"
        loading={end.isPending}
        onConfirm={() => ending && end.mutate(ending.id, { onSuccess: () => (toast.success('Banner ended'), setEnding(null)), onError: (e) => toast.error(e.message) })}
      />
    </Card>
  )
}

export function AnnouncementsTab() {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Composer kind="announcement" />
      <BroadcastList kind="announcement" />
    </div>
  )
}

// ---------------------------------------------------------------- notifications log
function NotificationLog() {
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const { data: templates } = useTemplates()
  const log = useNotificationLog({ kind, q: debounced.trim() })
  const rows = log.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <h2 className="text-base font-semibold">Sent notifications</h2>
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:ml-auto xl:w-auto xl:grid-cols-[14rem_12rem]">
          <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or title" aria-label="Search notifications" />
          <NativeSelect aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {templates?.map((t) => <option key={t.code} value={t.code}>{t.code.replace(/_/g, ' ')}</option>)}
          </NativeSelect>
        </div>
      </div>
      {log.error ? (
        <ErrorState message={log.error.message} onRetry={() => void log.refetch()} />
      ) : log.isLoading ? (
        <div className="grid gap-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<Bell />} title="Nothing matches" body="Notifications people receive are listed here." />
      ) : (
        <div className="animate-reveal">
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Notification</Th>
                  <Th>Recipient</Th>
                  <Th>Read</Th>
                  <Th className="hidden md:table-cell">Email</Th>
                  <Th className="text-right">Sent</Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((n) => (
                  <Tr key={n.id}>
                    <Td className="max-w-[18rem]">
                      <p className="truncate font-medium">{n.title}</p>
                      <p className="truncate text-xs text-muted">{n.kind.replace(/_/g, ' ')}</p>
                    </Td>
                    <Td className="max-w-[12rem] truncate text-muted">{n.recipient}</Td>
                    <Td>{n.read ? <Badge tone="success">Read</Badge> : <Badge tone="neutral">Unread</Badge>}</Td>
                    <Td className="hidden md:table-cell">{n.emailed ? <Mail className="size-4 text-success" aria-label="Emailed" /> : <span className="text-muted">–</span>}</Td>
                    <Td className="text-right text-xs text-muted tabular">{relativeDate(n.created_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <LoadMore shown={rows.length} noun="notifications" hasMore={!!log.hasNextPage} loading={log.isFetchingNextPage} onMore={() => void log.fetchNextPage()} />
        </div>
      )}
    </Card>
  )
}

export function NotificationsTab() {
  const { data: s } = useNotificationStats()
  return (
    <div className="grid gap-6">
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        {s ? (
          <>
            <StatCard label="Sent (30 days)" value={s.sent_30d} icon={<Bell />} />
            <StatCard label="Read" value={s.read_pct == null ? '–' : `${s.read_pct}%`} icon={<Eye />} tone="success" />
            <StatCard label="Emailed (30 days)" value={s.emailed_30d} icon={<Mail />} tone="info" />
            <StatCard label="Broadcasts (30 days)" value={s.broadcasts_30d} icon={<Megaphone />} tone="warning" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-lg" />)
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Composer kind="broadcast" />
        <BroadcastList kind="broadcast" />
      </div>
      <NotificationLog />
    </div>
  )
}

// ---------------------------------------------------------------- templates
const AUDIENCE_LABEL: Record<string, string> = { learner: 'Learners', instructor: 'Instructors', company_admin: 'Company admins', staff: 'Staff', other: 'Other' }

function TemplateEditor({ t }: { t: ConsoleTemplate }) {
  const { save, reset } = useSaveTemplate(t.code)
  const preview = usePreviewTemplate(t.code)
  const [v, setV] = useState({ title: t.title, body: t.body, email_enabled: t.email_enabled, is_active: t.is_active })
  useEffect(() => setV({ title: t.title, body: t.body, email_enabled: t.email_enabled, is_active: t.is_active }), [t])
  const dirty = v.title !== t.title || v.body !== t.body || v.email_enabled !== t.email_enabled || v.is_active !== t.is_active
  const debounced = useDebounced(v, 400)
  const { mutate: runPreview } = preview
  useEffect(() => runPreview({ title: debounced.title, body: debounced.body }), [debounced.title, debounced.body, runPreview])
  const error = save.error?.message ?? preview.error?.message
  const isDefault = t.title === t.default_title && t.body === t.default_body

  return (
    <div className="grid animate-reveal gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-semibold">{t.code}</h3>
        <Badge tone="neutral">{AUDIENCE_LABEL[t.audience] ?? t.audience}</Badge>
        {isDefault ? null : <Badge tone="info">Edited</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Placeholders you can use">
        {t.placeholders.map((p) => (
          <button key={p} type="button" className="rounded-md bg-primary-soft px-2 py-0.5 font-mono text-xs text-primary-soft-text hover:bg-primary-soft/70" onClick={() => setV({ ...v, body: `${v.body}{${p}}` })} title="Add to the message">
            {`{${p}}`}
          </button>
        ))}
      </div>
      <Field label="Title (and email subject)">{(p) => <Input {...p} maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
      <Field label="Message">{(p) => <Textarea {...p} maxLength={5000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className="min-h-24" />}</Field>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><Switch checked={v.is_active} onCheckedChange={(c) => setV({ ...v, is_active: c })} aria-label="Active" /> Active</label>
        <label className="flex items-center gap-2"><Switch checked={v.email_enabled} onCheckedChange={(c) => setV({ ...v, email_enabled: c })} aria-label="Also send by email" /> Also send by email</label>
      </div>
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      <div className="rounded-lg border border-dashed border-border-strong bg-surface-2/50 p-3">
        <p className="text-[11px] font-medium tracking-wider text-subtle uppercase">Preview with sample values</p>
        {preview.data ? (
          <div className="mt-2 text-sm">
            <p className="font-medium">{preview.data.title}</p>
            <p className="text-muted">{preview.data.body}</p>
          </div>
        ) : (
          <Skeleton className="mt-2 h-10" />
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={isDefault} loading={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: () => toast.success('Back to the default wording') })}>
          <RotateCcw /> Use default
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => setV({ title: t.title, body: t.body, email_enabled: t.email_enabled, is_active: t.is_active })}>
          Discard
        </Button>
        <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(v, { onSuccess: () => toast.success('Template saved') })}>
          <Save /> Save template
        </Button>
      </div>
    </div>
  )
}

export function TemplatesTab() {
  const { data, isLoading, error, refetch } = useTemplates()
  const [audience, setAudience] = useState('')
  const [q, setQ] = useState('')
  const [code, setCode] = useState('')
  const rows = useMemo(() => (data ?? []).filter((t) => (!audience || t.audience === audience) && (!q || `${t.code} ${t.title}`.toLowerCase().includes(q.toLowerCase()))), [data, audience, q])
  const current = data?.find((t) => t.code === code) ?? rows[0]
  if (error) return <ErrorState message={error.message} onRetry={() => void refetch()} />
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <div className="grid gap-2 border-b border-border p-3">
          <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
          <NativeSelect aria-label="Filter by audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="">Everyone</option>
            {Object.entries(AUDIENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
        </div>
        {isLoading ? (
          <div className="grid gap-2 p-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !rows.length ? (
          <EmptyState icon={<Search />} title="No templates match" />
        ) : (
          <ul className="stagger max-h-[60vh] overflow-y-auto p-1.5" aria-label="Notification templates">
            {rows.map((t) => (
              <li key={t.code}>
                <button type="button" aria-current={current?.code === t.code} onClick={() => setCode(t.code)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm transition-colors', current?.code === t.code ? 'bg-primary-soft text-primary-soft-text' : 'hover:bg-surface-2')}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs">{t.code}</span>
                    {t.is_active ? null : <Badge tone="neutral">Off</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted">{t.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="min-w-0">
        <CardBody>{current ? <TemplateEditor t={current} /> : isLoading ? <Skeleton className="h-64" /> : <Label>Choose a template</Label>}</CardBody>
      </Card>
    </div>
  )
}


