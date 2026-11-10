import { CheckCircle2, Clock, MailPlus, Send, ShieldAlert, XCircle } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, NativeSelect, Textarea } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { type Invite, ROLE_LABEL, unitLabel, useAssignableRoles, useCompany, useCreateInvite, useInvites, useIsOrgAdmin, useJobRoles, useRefreshInvites, useRevokeInvite, useUnits } from '@/features/org/api'
import { RoleBadge } from '@/features/org/ui'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** Emails separated by commas, semicolons, spaces or new lines; duplicates removed. */
function parseEmails(text: string) {
  return Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)))
}

type Outcome = { email: string; ok: boolean; message?: string }

function InviteForm() {
  const roles = useAssignableRoles()
  const { data: company } = useCompany()
  const { data: units } = useUnits()
  const { data: jobRoles } = useJobRoles()
  const create = useCreateInvite()
  const refreshInvites = useRefreshInvites()
  const [text, setText] = useState('')
  const [role, setRole] = useState('learner')
  const [unitId, setUnitId] = useState('')
  const [jobRoleId, setJobRoleId] = useState('')
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<Outcome[] | null>(null)
  const emails = parseEmails(text)
  const seatsLeft = company?.seat_limit ? company.seat_limit - company.seats_used : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!emails.length || sending) return
    setSending(true)
    setResults(null)
    const out: Outcome[] = []
    // one at a time: each invite checks seats, so the order matters
    for (const email of emails) {
      try {
        await create.mutateAsync({ email, role, unit_id: unitId || null, job_role_id: jobRoleId || null })
        out.push({ email, ok: true })
      } catch (err) {
        out.push({ email, ok: false, message: (err as Error).message })
      }
    }
    setSending(false)
    setResults(out)
    void refreshInvites()
    const sent = out.filter((o) => o.ok).length
    if (sent) toast.success(sent === 1 ? 'Invitation sent' : `${sent} invitations sent`)
    if (sent < out.length) toast.error(`${out.length - sent} could not be sent`)
    // keep only the addresses that failed, so they can be fixed and sent again
    setText(out.filter((o) => !o.ok).map((o) => o.email).join('\n'))
  }

  return (
    <Card className="self-start">
      <CardHeader title="Invite people" description="They get an email with a link to join. Links last 7 days." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Email addresses" hint={emails.length ? `${emails.length} ${emails.length === 1 ? 'address' : 'addresses'}` : 'One or many. Separate them with commas or new lines.'}>
            {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} placeholder={'sam@company.com\nalex@company.com'} rows={5} required />}
          </Field>
          <Field label="Role">
            {(p) => (
              <NativeSelect {...p} value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unit (optional)">
              {(p) => (
                <NativeSelect {...p} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  <option value="">No unit</option>
                  {units?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitLabel(u, units)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Job role (optional)">
              {(p) => (
                <NativeSelect {...p} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
                  <option value="">No job role</option>
                  {jobRoles?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          {seatsLeft !== null ? (
            <p className={seatsLeft > 0 ? 'text-xs text-muted' : 'inline-flex items-center gap-1.5 text-xs text-danger'}>
              {seatsLeft > 0 ? (
                `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left`
              ) : (
                <>
                  <ShieldAlert className="size-3.5" /> All seats are in use. <Link to="/business/billing" className="font-medium underline">Add seats</Link>
                </>
              )}
            </p>
          ) : null}
          <Button type="submit" loading={sending} disabled={!emails.length}>
            <Send /> {emails.length > 1 ? `Send ${emails.length} invitations` : 'Send invitation'}
          </Button>
        </form>
        {results ? (
          <ul className="stagger mt-5 grid gap-1.5 border-t border-border pt-4 text-sm" aria-live="polite">
            {results.map((r) => (
              <li key={r.email} className="flex items-start gap-2">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className="min-w-0 break-words">
                  <span className="font-medium">{r.email}</span>
                  <span className="text-muted"> · {r.ok ? 'invited' : r.message}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  )
}

function RevokeButton({ invite }: { invite: Invite }) {
  const revoke = useRevokeInvite()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <DialogContent title="Revoke this invitation?" description={`The link sent to ${invite.email} will stop working. You can invite them again later.`}>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={revoke.isPending}
            onClick={() => revoke.mutate(invite.id, { onSuccess: () => (toast.success('Invitation revoked'), setOpen(false)), onError: (e) => toast.error((e as Error).message) })}
          >
            Revoke
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Pending() {
  const { data, isLoading, error, refetch } = useInvites()
  return (
    <Card>
      <CardHeader title="Waiting to join" description={data ? `${data.length} pending ${data.length === 1 ? 'invitation' : 'invitations'}` : 'Pending invitations'} />
      <div className="mt-3">
        {error ? (
          <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
        ) : isLoading || !data ? (
          <div className="grid gap-3 p-5">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={<MailPlus />} title="No pending invitations" body="Everyone you invited has joined, or the links have expired." />
        ) : (
          <div className="animate-reveal">
            <Table>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th className="hidden sm:table-cell">Sent</Th>
                  <Th>Expires</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {data.map((i) => {
                  const soon = new Date(i.expires_at).getTime() - Date.now() < 2 * 86_400_000
                  return (
                    <Tr key={i.id}>
                      <Td>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={i.email} size="sm" className="hidden sm:inline-flex" />
                          <span className="max-w-[12rem] truncate font-medium sm:max-w-[18rem]">{i.email}</span>
                        </div>
                      </Td>
                      <Td>
                        <RoleBadge role={i.role} />
                      </Td>
                      <Td className="hidden whitespace-nowrap text-muted sm:table-cell">{shortDate(i.created_at)}</Td>
                      <Td className={soon ? 'whitespace-nowrap text-warning' : 'whitespace-nowrap text-muted'}>
                        <span className="inline-flex items-center gap-1" title={shortDate(i.expires_at)}>
                          <Clock className="size-3.5" /> {relativeDate(i.expires_at)}
                        </span>
                      </Td>
                      <Td className="text-right">
                        <RevokeButton invite={i} />
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  )
}

export function InvitesPage() {
  const admin = useIsOrgAdmin()
  return (
    <>
      <PageHeader title="Invitations" description="Bring people into your company workspace." />
      {admin ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <InviteForm />
          <Pending />
        </div>
      ) : (
        <Card>
          <EmptyState icon={<ShieldAlert />} title="Only admins can invite people" body="Ask a company admin to invite someone. You can still see and manage the people in your units." action={<Button variant="secondary" asChild><Link to="/business/people">Go to people</Link></Button>} />
        </Card>
      )}
    </>
  )
}
