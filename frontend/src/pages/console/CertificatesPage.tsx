import { Award, BadgeCheck, CalendarClock, CheckCircle2, Copy, Download, ExternalLink, Eye, FileBadge, MoreHorizontal, Pencil, Plus, Settings2, ShieldCheck, Star, Upload, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Label, NativeSelect } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { CertificatePreview } from '@/features/console/certificate-preview'
import {
  type CertLayout,
  type CertTemplate,
  certificatePdfPath,
  DEFAULT_LAYOUT,
  type IssuedCert,
  issuedCsvPath,
  templatePreviewPath,
  type TemplateInput,
  uploadSignature,
  useCertOverview,
  useCertTemplates,
  useIssuedCerts,
  useRevokeCertificate,
  useSaveTemplate,
  useSetExpiry,
  useTemplateAction,
  useVerifyCertificate,
} from '@/features/console/certificates'
import { SearchBox, Toolbar } from '@/features/console/money-ui'
import { ConfirmDialog, downloadCsv, ExportButton, KpiCard, LoadMore, StatusPill, useParam } from '@/features/console/ui'
import { useDebounced } from '@/features/org/ui'
import { API_BASE_URL } from '@/lib/env'
import { cn } from '@/lib/cn'
import { relativeDate, shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

const CERT_STATUS: Record<string, { tone: string; label: string }> = {
  valid: { tone: 'valid', label: 'Valid' },
  expiring: { tone: 'pending', label: 'Expiring soon' },
  expired: { tone: 'expired', label: 'Expired' },
  revoked: { tone: 'revoked', label: 'Revoked' },
}

// ---------------------------------------------------------------- template editor
function TemplateEditor({ template, open, onOpenChange }: { template: CertTemplate | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveTemplate()
  const blank: TemplateInput = { name: '', layout: DEFAULT_LAYOUT, signatory_name: '', signatory_title: '', signature_image_url: '', show_qr_code: true }
  const [f, setF] = useState<TemplateInput>(blank)
  const [preview, setPreview] = useState('')
  const [uploading, setUploading] = useState(false)
  useEffect(() => {
    if (!open) return
    setF(template ? { name: template.name, layout: template.layout, signatory_name: template.signatory_name, signatory_title: template.signatory_title, signature_image_url: template.signature_image_url, show_qr_code: template.show_qr_code } : blank)
    setPreview(template?.signature_preview_url ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template])
  const L = <K extends keyof CertLayout>(k: K, v: CertLayout[K]) => setF((x) => ({ ...x, layout: { ...x.layout, [k]: v } }))
  const toggles: [keyof CertLayout, string][] = [['show_platform', 'Platform name'], ['show_seal', 'Seal'], ['show_cpd', 'CPD hours'], ['show_instructor', 'Instructor name']]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={template ? `Edit "${template.name}"` : 'Create template'} description="The preview is drawn from the same settings as the PDF." className="max-w-4xl">
        <form
          className="grid gap-5 lg:grid-cols-[1fr_1.1fr]"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ ...f, id: template?.id }, { onSuccess: () => (toast.success(template ? 'Template saved' : 'Template created'), onOpenChange(false)), onError: (err) => toast.error((err as Error).message) })
          }}
        >
          <div className="grid content-start gap-3">
            <Field label="Template name">{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={3} maxLength={120} required />}</Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Style">
                {(p) => (
                  <NativeSelect {...p} value={f.layout.style} onChange={(e) => L('style', e.target.value)}>
                    <option value="classic">Classic</option>
                    <option value="modern">Modern</option>
                    <option value="minimal">Minimal</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Main colour">{(p) => <Input {...p} type="color" value={f.layout.primary} onChange={(e) => L('primary', e.target.value.toUpperCase())} className="h-10 p-1" />}</Field>
              <Field label="Accent colour">{(p) => <Input {...p} type="color" value={f.layout.accent} onChange={(e) => L('accent', e.target.value.toUpperCase())} className="h-10 p-1" />}</Field>
            </div>
            <Field label="Heading">{(p) => <Input {...p} value={f.layout.heading} maxLength={60} onChange={(e) => L('heading', e.target.value)} required />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Line before the name">{(p) => <Input {...p} value={f.layout.intro} maxLength={80} onChange={(e) => L('intro', e.target.value)} required />}</Field>
              <Field label="Line before the course">{(p) => <Input {...p} value={f.layout.completion} maxLength={80} onChange={(e) => L('completion', e.target.value)} required />}</Field>
            </div>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1 text-sm font-medium">Show</legend>
              {toggles.map(([k, label]) => (
                <label key={k} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                  {label}
                  <Switch checked={Boolean(f.layout[k])} onCheckedChange={(v) => L(k, v as never)} aria-label={`Show ${label.toLowerCase()}`} />
                </label>
              ))}
              <label className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
                QR code
                <Switch checked={f.show_qr_code} onCheckedChange={(v) => setF({ ...f, show_qr_code: v })} aria-label="Show the QR code" />
              </label>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Signatory">{(p) => <Input {...p} value={f.signatory_name} maxLength={120} onChange={(e) => setF({ ...f, signatory_name: e.target.value })} placeholder="Ayman Badewi" />}</Field>
              <Field label="Signatory's title">{(p) => <Input {...p} value={f.signatory_title} maxLength={120} onChange={(e) => setF({ ...f, signatory_title: e.target.value })} placeholder="Platform administrator" />}</Field>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sig-file">Signature image (PNG or JPEG, up to 1 MB)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="secondary" size="sm" loading={uploading}>
                  <label htmlFor="sig-file" className="cursor-pointer"><Upload /> Upload signature</label>
                </Button>
                <input
                  id="sig-file"
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    setUploading(true)
                    try {
                      const url = await uploadSignature(file)
                      setF((x) => ({ ...x, signature_image_url: url }))
                      setPreview(URL.createObjectURL(file))
                      toast.success('Signature uploaded')
                    } catch (err) {
                      toast.error((err as Error).message)
                    } finally {
                      setUploading(false)
                    }
                  }}
                />
                {f.signature_image_url ? <Button type="button" size="sm" variant="ghost" onClick={() => (setF({ ...f, signature_image_url: '' }), setPreview(''))}>Remove</Button> : <span className="text-[12.5px] text-muted">Without one, the name is written in script.</span>}
              </div>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <CertificatePreview data={{ ...f, signature_preview_url: preview }} />
            {template?.status === 'pending' ? <p className="text-[12.5px] text-warning">An instructor's template: approve it in Approvals.</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>{template ? 'Save template' : 'Create template'}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- expiry dialog
function ExpiryDialog({ cert, onOpenChange }: { cert: IssuedCert | null; onOpenChange: (o: boolean) => void }) {
  const set = useSetExpiry()
  const [date, setDate] = useState('')
  useEffect(() => setDate(cert?.expires_at ? cert.expires_at.slice(0, 10) : ''), [cert])
  const run = (value: string | null) =>
    set.mutate({ id: cert!.id, expires_at: value }, { onSuccess: (r) => (toast.success(value ? `Expiry set (${CERT_STATUS[r.status]?.label ?? r.status})` : 'The certificate no longer expires'), onOpenChange(false)), onError: (e) => toast.error((e as Error).message) })
  return (
    <Dialog open={!!cert} onOpenChange={onOpenChange}>
      <DialogContent title="Set expiry date" description={cert ? `${cert.code} · ${cert.recipient_name}, ${cert.course_title}` : undefined}>
        <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), date && run(new Date(`${date}T23:59:00`).toISOString()))}>
          <Field label="Expires on" hint="The learner is reminded 30 days before. A past date makes it expired straight away.">
            {(p) => <Input {...p} type="date" value={date} min={cert?.issued_at.slice(0, 10)} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {cert?.expires_at ? <Button type="button" variant="ghost" onClick={() => run(null)} loading={set.isPending && set.variables?.expires_at === null}>Never expires</Button> : null}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={set.isPending} disabled={!date}>Set expiry</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- templates table
function Templates({ selected, onSelect, onEdit }: { selected: string; onSelect: (t: CertTemplate) => void; onEdit: (t: CertTemplate | null) => void }) {
  const { data, error, refetch } = useCertTemplates()
  const act = useTemplateAction()
  const [archive, setArchive] = useState<CertTemplate | null>(null)
  const run = (t: CertTemplate, action: 'duplicate' | 'default' | 'archive') =>
    act.mutate({ id: t.id, action }, { onSuccess: () => (toast.success(action === 'duplicate' ? 'Copy created' : action === 'default' ? `"${t.name}" is now the default` : 'Template archived'), setArchive(null)), onError: (e) => toast.error((e as Error).message) })
  const rows = (data ?? []).filter((t) => t.status !== 'archived')
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><FileBadge className="size-4 text-primary" aria-hidden /> Certificate templates {data ? <span className="text-muted tabular">({rows.length})</span> : null}</span>} description="Create, edit and manage the designs certificates are drawn with." action={<Button size="sm" onClick={() => onEdit(null)}><Plus /> Create template</Button>} />
      {error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : !data ? (
        <div className="grid gap-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileBadge />} title="No templates yet" body="Create the platform's first certificate design." />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Template</Th>
                <Th>Type</Th>
                <Th className="hidden md:table-cell">Created by</Th>
                <Th className="hidden sm:table-cell">Courses</Th>
                <Th>Status</Th>
                <Th className="hidden lg:table-cell">Last updated</Th>
                <Th className="w-12"><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((t) => (
                <Tr key={t.id} className={cn(selected === t.id && 'bg-primary-soft/30')}>
                  <Td>
                    <button type="button" onClick={() => onSelect(t)} className="flex items-center gap-2 text-left font-medium hover:text-primary focus-visible:underline focus-visible:outline-none">
                      <span aria-hidden className="h-6 w-8 shrink-0 rounded-sm border-2" style={{ borderColor: t.layout.primary, background: `linear-gradient(135deg, ${t.layout.accent}33, transparent)` }} />
                      <span className="min-w-0 truncate">{t.name}</span>
                      {t.is_default ? <Badge tone="primary">Default</Badge> : null}
                    </button>
                  </Td>
                  <Td><Badge tone={t.type === 'platform' ? 'primary' : 'info'}>{t.type === 'platform' ? 'Platform' : 'Instructor'}</Badge></Td>
                  <Td className="hidden text-[13px] md:table-cell">{t.created_by}</Td>
                  <Td className="hidden text-[13px] tabular sm:table-cell">{t.is_default ? `${t.courses} (default)` : t.courses}</Td>
                  <Td><StatusPill status={t.status} label={t.status === 'pending' ? 'Pending' : undefined} /></Td>
                  <Td className="hidden text-[13px] whitespace-nowrap text-muted lg:table-cell">{relativeDate(t.updated_at)}</Td>
                  <Td>
                    <Menu>
                      <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${t.name}`}><MoreHorizontal /></Button></MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => onSelect(t)}><Eye /> Preview</MenuItem>
                        <MenuItem onSelect={() => onEdit(t)}><Pencil /> Edit</MenuItem>
                        <MenuItem onSelect={() => run(t, 'duplicate')}><Copy /> Duplicate</MenuItem>
                        {t.type === 'platform' && t.status === 'active' && !t.is_default ? <MenuItem onSelect={() => run(t, 'default')}><Star /> Set as default</MenuItem> : null}
                        {t.status === 'pending' ? <MenuItem asChild><Link to={`/console/approvals?tab=templates&kind=template&item=${t.id}`}><BadgeCheck /> Review in Approvals</Link></MenuItem> : null}
                        <MenuSeparator />
                        <MenuItem disabled={t.is_default} onSelect={() => setArchive(t)} className="text-danger"><XCircle /> Archive</MenuItem>
                      </MenuContent>
                    </Menu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <ConfirmDialog open={!!archive} onOpenChange={(o) => !o && setArchive(null)} title={`Archive "${archive?.name}"?`} body="Courses using it switch to the default template. Certificates already issued are redrawn with the new design." confirmLabel="Archive" loading={act.isPending} onConfirm={() => archive && run(archive, 'archive')} />
    </Card>
  )
}

// ---------------------------------------------------------------- issued table
function Issued({ selected, onSelect, onRevoke, onExpiry }: { selected: string; onSelect: (c: IssuedCert) => void; onRevoke: (c: IssuedCert) => void; onExpiry: (c: IssuedCert) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const term = useDebounced(q, 300)
  const list = useIssuedCerts({ q: term, status })
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data])
  const pdf = (c: IssuedCert) => downloadCsv(certificatePdfPath(c.id), `certificate-${c.code}.pdf`)
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Award className="size-4 text-primary" aria-hidden /> Issued certificates</span>} description="View and manage certificates issued to learners." />
      <Toolbar>
        <SearchBox value={q} onChange={setQ} label="Search certificates" placeholder="Search by certificate ID, learner, course or email" className="sm:max-w-sm" />
        <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-44">
          <option value="">All statuses</option>
          <option value="valid">Valid</option>
          <option value="expiring">Expiring in 30 days</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </NativeSelect>
        <span className="sm:ml-auto"><ExportButton path={issuedCsvPath({ q: term, status })} filename="certificates.csv" /></span>
      </Toolbar>
      {list.error ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="grid gap-2 p-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Award />} title="No certificates match" body={term || status ? 'Try another search or filter.' : 'Certificates appear here when learners finish courses.'} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Certificate ID</Th>
                  <Th>Learner</Th>
                  <Th className="hidden md:table-cell">Course</Th>
                  <Th className="hidden lg:table-cell">Issued</Th>
                  <Th className="hidden lg:table-cell">Expires</Th>
                  <Th>Status</Th>
                  <Th className="w-12"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((c) => (
                  <Tr key={c.id} className={cn(selected === c.id && 'bg-primary-soft/30')}>
                    <Td><button type="button" onClick={() => onSelect(c)} className="font-mono text-[13px] font-medium hover:text-primary focus-visible:underline focus-visible:outline-none">{c.code}</button></Td>
                    <Td><span className="block max-w-[12rem] truncate text-[13px]">{c.recipient_name}</span><span className="block max-w-[12rem] truncate text-[12px] text-muted">{c.email}</span></Td>
                    <Td className="hidden md:table-cell"><span className="line-clamp-2 max-w-[16rem] text-[13px]">{c.course_title}</span></Td>
                    <Td className="hidden text-[13px] whitespace-nowrap lg:table-cell">{shortDate(c.issued_at)}</Td>
                    <Td className="hidden text-[13px] whitespace-nowrap lg:table-cell">{c.expires_at ? shortDate(c.expires_at) : '—'}</Td>
                    <Td><StatusPill status={CERT_STATUS[c.status]?.tone ?? c.status} label={CERT_STATUS[c.status]?.label} /></Td>
                    <Td>
                      <Menu>
                        <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${c.code}`}><MoreHorizontal /></Button></MenuTrigger>
                        <MenuContent>
                          <MenuItem onSelect={() => void pdf(c)}><Download /> Download PDF</MenuItem>
                          <MenuItem asChild><a href={`/verify/${c.code}`} target="_blank" rel="noreferrer"><ExternalLink /> Public check page</a></MenuItem>
                          {c.status !== 'revoked' ? (
                            <>
                              <MenuItem onSelect={() => onExpiry(c)}><CalendarClock /> Set expiry date</MenuItem>
                              <MenuSeparator />
                              <MenuItem onSelect={() => onRevoke(c)} className="text-danger"><XCircle /> Revoke</MenuItem>
                            </>
                          ) : null}
                        </MenuContent>
                      </Menu>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <LoadMore shown={rows.length} noun="certificates" hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- verify box
function VerifyBox() {
  const [code, setCode] = useState('')
  const verify = useVerifyCertificate()
  const r = verify.data
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" aria-hidden /> Verify certificate</span>} description="Check a certificate using its ID." />
      <CardBody>
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), code.trim() && verify.mutate(code.trim()))}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Certificate ID" aria-label="Certificate ID" maxLength={20} className="font-mono" />
          <Button type="submit" loading={verify.isPending}>Verify</Button>
        </form>
        {verify.error ? <p role="alert" className="mt-3 text-[13px] text-danger">{(verify.error as Error).message}</p> : null}
        {r ? (
          <div role="status" className="mt-3 animate-reveal rounded-md border border-border p-3 text-[13px]">
            {r.found ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  {r.status === 'revoked' || r.status === 'expired' ? <XCircle className="size-4 text-danger" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                  {r.code} · {CERT_STATUS[r.status]?.label ?? r.status}
                </p>
                <p className="mt-1">{r.recipient_name}, {r.course_title}</p>
                <p className="text-muted">Issued {r.issued_at ? shortDate(r.issued_at) : ''}{r.expires_at ? ` · expires ${shortDate(r.expires_at)}` : ''}</p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-danger"><XCircle className="size-4" aria-hidden /> No certificate has the ID {r.code}.</p>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- page
export function ConsoleCertificatesPage() {
  const k = useCertOverview()
  const templates = useCertTemplates()
  const [templateId, setTemplateId] = useParam('template')
  const [cert, setCert] = useState<IssuedCert | null>(null)
  const [editing, setEditing] = useState<{ t: CertTemplate | null } | null>(null)
  const [revoking, setRevoking] = useState<IssuedCert | null>(null)
  const [expiry, setExpiry] = useState<IssuedCert | null>(null)
  const revoke = useRevokeCertificate()
  const act = useTemplateAction()
  const live = (templates.data ?? []).filter((t) => t.status !== 'archived')
  const shown = live.find((t) => t.id === templateId) ?? live.find((t) => t.is_default) ?? live[0]
  return (
    <>
      <PageHeader title="Certificate management" description="Create and manage certificate templates, review instructors' templates, and check, expire or revoke issued certificates." />
      <section aria-label="Certificate figures" className={cn('mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4', k.data && 'stagger')}>
        {k.error ? (
          <div className="sm:col-span-2 xl:col-span-4"><ErrorState message={(k.error as Error).message} onRetry={() => void k.refetch()} /></div>
        ) : !k.data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[110px]" />)
        ) : (
          <>
            <StatCard label="Templates" value={k.data.templates} icon={<FileBadge />} />
            <StatCard label="Pending approvals" value={k.data.pending} icon={<BadgeCheck />} tone="warning" hint={k.data.pending ? <Link to="/console/approvals?tab=templates" className="text-primary hover:underline">Review now</Link> : undefined} />
            <KpiCard label="Issued in the last 30 days" kpi={k.data.issued} icon={<Award />} tone="success" />
            <StatCard label="Expiring soon" value={k.data.expiring_soon} icon={<CalendarClock />} tone="danger" hint="in the next 30 days" />
          </>
        )}
      </section>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="grid min-w-0 content-start gap-5">
          <Templates selected={shown?.id ?? ''} onSelect={(t) => setTemplateId(t.id)} onEdit={(t) => setEditing({ t })} />
          <Issued selected={cert?.id ?? ''} onSelect={setCert} onRevoke={setRevoking} onExpiry={setExpiry} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Eye className="size-4 text-primary" aria-hidden /> Certificate preview</span>} description={shown ? `${shown.name}, with sample details` : undefined} />
            <CardBody className="grid gap-3">
              {templates.isLoading ? <Skeleton className="aspect-[297/210]" /> : shown ? <CertificatePreview data={shown} className="animate-reveal" key={shown.id} /> : <EmptyState icon={<FileBadge />} title="No template to show" />}
              {shown ? (
                <Button asChild variant="secondary">
                  <a href={`${API_BASE_URL}${templatePreviewPath(shown.id)}`} target="_blank" rel="noreferrer"><ExternalLink /> View full size</a>
                </Button>
              ) : null}
            </CardBody>
          </Card>
          <VerifyBox />
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Settings2 className="size-4 text-primary" aria-hidden /> Certificate actions</span>} description={cert ? `Certificate ${cert.code}` : 'Choose a template or a certificate first.'} />
            <ul className="grid p-2">
              {[
                { icon: <Pencil />, label: 'Edit template', on: () => shown && setEditing({ t: shown }), ok: !!shown },
                { icon: <Copy />, label: 'Duplicate template', on: () => shown && act.mutate({ id: shown.id, action: 'duplicate' }, { onSuccess: () => toast.success('Copy created'), onError: (e) => toast.error((e as Error).message) }), ok: !!shown },
                { icon: <XCircle />, label: 'Revoke certificate', on: () => cert && setRevoking(cert), ok: !!cert && cert.status !== 'revoked' },
                { icon: <CalendarClock />, label: 'Set expiry date', on: () => cert && setExpiry(cert), ok: !!cert && cert.status !== 'revoked' },
                { icon: <Download />, label: 'Download certificate (PDF)', on: () => cert && void downloadCsv(certificatePdfPath(cert.id), `certificate-${cert.code}.pdf`), ok: !!cert },
              ].map((a) => (
                <li key={a.label}>
                  <button type="button" disabled={!a.ok} onClick={a.on} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:text-primary">
                    {a.icon} {a.label}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <TemplateEditor template={editing?.t ?? null} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ExpiryDialog cert={expiry} onOpenChange={(o) => !o && setExpiry(null)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke ${revoking?.code}?`}
        body={`${revoking?.recipient_name} is told why, the certificate leaves their account and the public check page says "revoked". This can't be undone.`}
        confirmLabel="Revoke certificate"
        reason="required"
        loading={revoke.isPending}
        onConfirm={(reason) => revoking && revoke.mutate({ id: revoking.id, reason }, { onSuccess: () => (toast.success('Certificate revoked. The learner has been told.'), setRevoking(null), setCert(null)), onError: (e) => toast.error((e as Error).message) })}
      />
    </>
  )
}
