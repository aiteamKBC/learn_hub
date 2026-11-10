import { CheckCircle2, Clock, Headphones, Inbox, Loader2, Lock, Paperclip, Plus, Search, Send, StickyNote, Timer, UserCheck, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { EmptyState, ErrorState, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { openTicketFile, PRIORITIES, TICKET_CATEGORIES, TICKET_STATUSES, type ConsoleTicketRow, uploadTicketFile, useConsoleTicket, useCreateTicket, useStaffReply, useTicketKpis, useTickets, useUpdateTicket } from '@/features/console/comms'
import { DetailSheet, LoadMore, StatusPill, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { cn } from '@/lib/cn'
import { relativeDate } from '@/lib/format'
import { RichText } from '@/pages/studio/builder/curriculum/RichText'

const minutes = (m: number | null | undefined) => (m == null ? '–' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`)
const PRIORITY_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'danger'> = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger' }
const isEmptyHtml = (html: string) => !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

function Kpis({ onCreate }: { onCreate: () => void }) {
  const { data, isLoading } = useTicketKpis()
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-lg" />
        ))}
      </div>
    )
  }
  const r = data.resolved_month
  const prev = data.avg_first_response_previous
  const now = data.avg_first_response_minutes
  const change = prev && now != null ? Math.round(((now - prev) * 100) / prev) : null
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open tickets" value={data.open} icon={<Headphones />} tone="warning" hint={`${data.waiting} waiting for the customer`} />
        <StatCard label="In progress" value={data.in_progress} icon={<Clock />} tone="info" />
        <StatCard label="Resolved (this month)" value={r.value} icon={<CheckCircle2 />} tone="success" trend={r.change_pct == null ? undefined : { value: `${Math.abs(r.change_pct)}%`, up: r.change_pct >= 0 }} hint={r.change_pct == null ? 'no earlier data' : 'vs last month'} />
        <StatCard label="Avg. first response" value={minutes(now)} icon={<Timer />} trend={change == null ? undefined : { value: `${Math.abs(change)}%`, up: change >= 0, good: change <= 0 }} hint={change == null ? 'this month' : 'vs last month'} />
      </div>
      <Button size="lg" className="self-start xl:self-center" onClick={onCreate}>
        <Plus /> Create support ticket
      </Button>
    </div>
  )
}

function CreateTicketDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const create = useCreateTicket()
  const [v, setV] = useState({ user_email: '', subject: '', category: 'account', priority: 'normal', body: '' })
  const err = create.error?.message
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create support ticket" description="For someone who contacted you another way. They are told and can reply from Help.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate(v, {
              onSuccess: (r) => {
                toast.success('Ticket created')
                onOpenChange(false)
                setV({ user_email: '', subject: '', category: 'account', priority: 'normal', body: '' })
                onCreated(r.id)
              },
            })
          }}
        >
          {err ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p> : null}
          <Field label="Customer's email">{(p) => <Input {...p} type="email" required value={v.user_email} onChange={(e) => setV({ ...v, user_email: e.target.value })} />}</Field>
          <Field label="Subject">{(p) => <Input {...p} required minLength={3} maxLength={200} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              {(p) => (
                <NativeSelect {...p} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
                  {Object.entries(TICKET_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
            <Field label="Priority">
              {(p) => (
                <NativeSelect {...p} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
                  {Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium" id="new-ticket-body-label">First message</span>
            <RichText id="new-ticket-body" label="First message" value={v.body} onChange={(body) => setV({ ...v, body })} minHeight={120} placeholder="What you told them, or what happens next" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={create.isPending} disabled={isEmptyHtml(v.body)}>Create ticket</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Thread({ id, onClose }: { id: string; onClose?: () => void }) {
  const t = useConsoleTicket(id)
  const reply = useStaffReply(id)
  const update = useUpdateTicket(id)
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<{ name: string; id?: string; pct: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (t.isLoading) {
    return (
      <div className="grid gap-3 p-5">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (t.error || !t.data) return <ErrorState message={t.error?.message ?? 'Ticket not found.'} onRetry={() => void t.refetch()} />
  const d = t.data
  const change = (body: { status?: string; priority?: string; assign_to_me?: boolean }, ok: string) =>
    update.mutate(body, { onSuccess: () => toast.success(ok), onError: (e) => toast.error(e.message) })

  async function attach(f: File) {
    setFile({ name: f.name, pct: 0 })
    try {
      const assetId = await uploadTicketFile(id, f, (pct) => setFile({ name: f.name, pct }))
      setFile({ name: f.name, id: assetId, pct: 100 })
    } catch (e) {
      setFile(null)
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex animate-reveal flex-col">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{d.reference}</span>
          <StatusPill status={d.status} label={TICKET_STATUSES[d.status]} />
          <Badge tone={PRIORITY_TONE[d.priority] ?? 'neutral'}>{PRIORITIES[d.priority]}</Badge>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" className="ml-auto hidden lg:inline-flex" aria-label="Close ticket panel" onClick={onClose}>
              <X />
            </Button>
          ) : null}
        </div>
        <h2 className="mt-2 text-lg font-semibold tracking-tight">{d.subject}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={d.requester.name || d.requester.email} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{d.requester.name || d.requester.email}</span>
              <span className="block truncate text-xs text-muted">{d.requester.email}</span>
            </span>
          </span>
          <span className="text-xs text-muted">
            Created {relativeDate(d.created_at)} · {TICKET_CATEGORIES[d.category] ?? d.category}
            {d.assigned_to ? ` · with ${d.assigned_to}` : ''}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <NativeSelect aria-label="Status" value={d.status} disabled={update.isPending} onChange={(e) => change({ status: e.target.value }, 'Status updated')}>
            {Object.entries(TICKET_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Priority" value={d.priority} disabled={update.isPending} onChange={(e) => change({ priority: e.target.value }, 'Priority updated')}>
            {Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l} priority</option>)}
          </NativeSelect>
          <Button variant="secondary" onClick={() => change({ assign_to_me: true }, 'Assigned to you')}>
            <UserCheck /> Assign to me
          </Button>
        </div>
      </div>

      <ol className="stagger grid gap-3 p-4 sm:p-5" aria-label="Conversation">
        {d.messages.map((m) => (
          <li key={m.id} className={cn('rounded-lg border p-3.5 text-sm', m.internal ? 'border-warning/40 bg-warning-soft/60' : m.is_staff ? 'border-primary/25 bg-primary-soft/40' : 'border-border bg-surface')}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-text">{m.author}</span>
              {m.internal ? <Badge tone="warning"><Lock /> Internal note</Badge> : m.is_staff ? <Badge tone="primary">Staff</Badge> : null}
              <span className="ml-auto text-muted">{relativeDate(m.created_at)}</span>
            </div>
            {/* body_html is cleaned on the server (nh3) */}
            <div className="prose-sm mt-2 break-words [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: m.body_html }} />
            {m.attachment ? (
              <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-surface-2" onClick={() => void openTicketFile(d.id, m.id).catch((e: Error) => toast.error(e.message))}>
                <Paperclip className="size-3.5" /> {m.attachment.name}
              </button>
            ) : null}
          </li>
        ))}
      </ol>

      <form
        className="border-t border-border p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (file && !file.id) return toast.error('Wait for the file to finish uploading.')
          reply.mutate(
            { body, internal: mode === 'note', attachment_id: file?.id ?? null },
            {
              onSuccess: () => {
                setBody('')
                setFile(null)
                toast.success(mode === 'note' ? 'Note added' : 'Reply sent')
              },
              onError: (er) => toast.error(er.message),
            },
          )
        }}
      >
        <div role="tablist" aria-label="Message type" className="mb-2 flex gap-1">
          {(['reply', 'note'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors', mode === k ? (k === 'note' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary-soft-text') : 'text-muted hover:bg-surface-2')}>
              {k === 'note' ? <><StickyNote className="size-3.5" /> Internal note</> : <><Send className="size-3.5" /> Reply</>}
            </button>
          ))}
        </div>
        <RichText id={`reply-${id}`} label={mode === 'note' ? 'Internal note' : 'Reply'} value={body} onChange={setBody} minHeight={110} placeholder={mode === 'note' ? 'Only staff see this' : 'Type your reply'} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" className="sr-only" aria-label="Attach a file" onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
          <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <Paperclip /> Attach
          </Button>
          {file ? (
            <span className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-md bg-surface-2 px-2 py-1 text-xs">
              {file.id ? <Paperclip className="size-3" /> : <Loader2 className="size-3 animate-spin" />}
              <span className="truncate">{file.name}</span>
              {file.id ? null : <span className="tabular">{file.pct}%</span>}
              <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
                <X className="size-3" />
              </button>
            </span>
          ) : null}
          <Button type="submit" className="ml-auto" variant={mode === 'note' ? 'secondary' : 'primary'} loading={reply.isPending} disabled={isEmptyHtml(body) && !file?.id}>
            {mode === 'note' ? <StickyNote /> : <Send />} {mode === 'note' ? 'Add note' : 'Send reply'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function TicketCard({ t, active, onOpen }: { t: ConsoleTicketRow; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn('w-full rounded-lg border bg-surface p-3.5 text-left shadow-sm transition-colors', active ? 'border-primary' : 'border-border hover:border-border-strong')}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono font-semibold">{t.reference}</span>
        <StatusPill status={t.status} label={TICKET_STATUSES[t.status]} />
        <span className="ml-auto text-muted">{relativeDate(t.last_message_at)}</span>
      </div>
      <p className="mt-1.5 truncate font-medium">{t.subject}</p>
      <p className="truncate text-xs text-muted">
        {t.requester_name} · {TICKET_CATEGORIES[t.category] ?? t.category}
      </p>
    </button>
  )
}

export function TicketsTab() {
  const [ticket, setTicket] = useParam('ticket')
  const [status, setStatus] = useParam('status')
  const [category, setCategory] = useParam('category')
  const [priority, setPriority] = useParam('priority')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const debounced = useDebounced(q)
  const filters = { status: status || 'active', category, priority, q: debounced.trim() }
  const list = useTickets(filters)
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const filtered = !!(debounced || category || priority || (status && status !== 'active'))

  return (
    <div className="grid gap-6">
      <Kpis onCreate={() => setCreating(true)} />
      <div className={cn('grid gap-6', ticket && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]')}>
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <h2 className="text-base font-semibold">
              Support tickets <span className="text-muted tabular">({total})</span>
            </h2>
            <div className="grid w-full gap-2 sm:grid-cols-2 xl:ml-auto xl:w-auto xl:grid-cols-[16rem_repeat(3,9.5rem)]">
              <Input icon={<Search />} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, subject or person" aria-label="Search tickets" />
              <NativeSelect aria-label="Filter by status" value={status || 'active'} onChange={(e) => setStatus(e.target.value === 'active' ? '' : e.target.value)}>
                <option value="active">Not resolved</option>
                <option value="">All statuses</option>
                {Object.entries(TICKET_STATUSES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {Object.entries(TICKET_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
              <NativeSelect aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">All priorities</option>
                {Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
            </div>
          </div>
          {list.error ? (
            <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          ) : list.isLoading ? (
            <div className="grid gap-3 p-4">
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={filtered ? <Search /> : <Inbox />} title={filtered ? 'No tickets match' : 'The queue is clear'} body={filtered ? 'Try other filters.' : 'New requests from learners, instructors and companies appear here.'} />
          ) : (
            <div className="animate-reveal">
              <ul className={cn('stagger grid gap-2.5 p-3', ticket ? '' : 'md:hidden')}>
                {rows.map((t) => (
                  <li key={t.id}>
                    <TicketCard t={t} active={t.id === ticket} onOpen={() => setTicket(t.id)} />
                  </li>
                ))}
              </ul>
              <div className={cn('hidden', !ticket && 'md:block')}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Ticket</Th>
                      <Th>Subject</Th>
                      <Th>Requester</Th>
                      <Th className="hidden xl:table-cell">Category</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Last activity</Th>
                    </tr>
                  </thead>
                  <tbody className="stagger">
                    {rows.map((t) => (
                      <Tr key={t.id} className="cursor-pointer" onClick={() => setTicket(t.id)}>
                        <Td className="font-mono text-xs font-semibold">
                          <button type="button" className="hover:text-primary" onClick={(e) => (e.stopPropagation(), setTicket(t.id))}>
                            {t.reference}
                          </button>
                        </Td>
                        <Td className="max-w-[16rem] truncate">{t.subject}</Td>
                        <Td>
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar name={t.requester_name} size="sm" />
                            <span className="max-w-[10rem] truncate">{t.requester_name}</span>
                          </span>
                        </Td>
                        <Td className="hidden xl:table-cell"><Badge tone="primary">{TICKET_CATEGORIES[t.category] ?? t.category}</Badge></Td>
                        <Td><StatusPill status={t.status} label={TICKET_STATUSES[t.status]} /></Td>
                        <Td className="text-right text-xs text-muted tabular">{relativeDate(t.last_message_at)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <LoadMore shown={rows.length} noun={rows.length === 1 ? 'ticket' : 'tickets'} hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
            </div>
          )}
        </Card>
        {ticket ? (
          <>
            <Card className="hidden min-w-0 self-start lg:block">
              <Thread key={ticket} id={ticket} onClose={() => setTicket('')} />
            </Card>
            <div className="lg:hidden">
              <DetailSheet open onOpenChange={(o) => !o && setTicket('')} title="Ticket">
                <div className="-m-4 sm:-m-5">
                  <Thread key={ticket} id={ticket} />
                </div>
              </DetailSheet>
            </div>
          </>
        ) : null}
      </div>
      <CreateTicketDialog open={creating} onOpenChange={setCreating} onCreated={setTicket} />
    </div>
  )
}
