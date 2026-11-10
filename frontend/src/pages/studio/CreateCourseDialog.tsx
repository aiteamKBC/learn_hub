import { Rocket } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { useCategories } from '@/features/catalog/api'
import { useCreateCourse } from '@/features/studio/api'
import { useNavigate } from '@/lib/router'

import { slugSuggestion } from './course-status'

/** Quick start (mockup 21): a title and an optional category, then straight into the builder. */
export function CreateCourseDialog({ trigger }: { trigger: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [touched, setTouched] = useState(false)
  const create = useCreateCourse()
  const { data: categories } = useCategories()
  const navigate = useNavigate()

  const clean = title.trim()
  const error = clean.length < 3 ? 'Use at least 3 characters.' : clean.length > 160 ? 'Keep it under 160 characters.' : undefined
  const slug = slugSuggestion(clean)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (error) return
    create.mutate(
      { title: clean, category_id: category || null },
      {
        onSuccess: (c) => {
          toast.success('Course created')
          setOpen(false)
          navigate(`/studio/courses/${c.id}`)
        },
        onError: (err) => toast.error((err as Error).message),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) (setTitle(''), setCategory(''), setTouched(false))
      }}
    >
      {trigger(() => setOpen(true))}
      <DialogContent title="Create a course" description="Start with a working title. You can change everything later in the builder.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Course title" error={touched ? error : undefined} hint="For example: Fire safety for small offices">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus required />}
          </Field>
          <p className="-mt-2 text-[13px] break-all text-muted" aria-live="polite">
            Suggested web address: <span className="font-mono text-text">/courses/{slug || 'your-course'}</span>
            <span className="block text-xs">We add a short code at the end so it's unique.</span>
          </p>
          <Field label="Category (optional)">
            {(p) => (
              <NativeSelect {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose later</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={create.isPending}>
              <Rocket /> Create and open builder
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
