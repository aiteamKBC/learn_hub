import { Flag } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/input'
import { useMe } from '@/features/identity/auth'

import { useReportContent } from './api'

const NOUN = { review: 'review', question: 'question', answer: 'answer' } as const

/** "Report" on a review, question or answer: a short reason goes to the moderators. */
export function ReportButton({ kind, id, authorId }: { kind: keyof typeof NOUN; id: string; authorId?: string | null }) {
  const { data: me } = useMe()
  const report = useReportContent()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [sent, setSent] = useState(false)
  if (!me || (authorId && authorId === me.id)) return null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    report.mutate(
      { target_type: kind, target_id: id, reason: reason.trim() },
      {
        onSuccess: () => (setSent(true), setOpen(false), setReason(''), toast.success('Thanks. A moderator will look at it.')),
        onError: (er) => toast.error(er.message),
      },
    )
  }
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted" disabled={sent} onClick={() => setOpen(true)} aria-label={`Report this ${NOUN[kind]}`}>
        <Flag /> {sent ? 'Reported' : 'Report'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Report this ${NOUN[kind]}`}>
          <form className="grid gap-4" onSubmit={submit}>
            <p className="text-sm text-muted">Tell us what is wrong. A moderator reviews every report; the author is not told who reported it.</p>
            <Field label="What is wrong?">
              {(f) => <Textarea {...f} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} placeholder="For example: offensive, spam or off topic" required />}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={report.isPending} disabled={reason.trim().length < 3}>Send report</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
