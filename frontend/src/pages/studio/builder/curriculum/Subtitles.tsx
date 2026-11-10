import { Captions, FileText, Plus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { useVideoCaptions, type VideoDetails } from '@/features/studio/api'

import { errText, fileSize } from './shared'

const MAX_BYTES = 1024 ** 2
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
]
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/

/** Subtitle files (.srt / .vtt, up to 1 MB). The text goes through our API to Bunny; we
 * don't keep a copy. One file per language. */
export function Subtitles({ assetId, captions, readOnly }: { assetId: string; captions: VideoDetails['captions']; readOnly?: boolean }) {
  const { add, remove } = useVideoCaptions(assetId)
  const uid = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [lang, setLang] = useState('en')
  const [other, setOther] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)

  const srclang = (lang === 'other' ? other.trim() : lang).toLowerCase()
  const fileErr = !file
    ? 'Choose a subtitle file.'
    : !/\.(srt|vtt)$/i.test(file.name)
      ? 'Use an .srt or .vtt file.'
      : file.size > MAX_BYTES
        ? 'Subtitle files can be up to 1 MB.'
        : ''
  const langErr = lang === 'other' && !LANG_RE.test(other.trim()) ? 'Use a language code such as "it" or "pt-BR".' : ''
  const replaces = captions.some((c) => c.srclang.toLowerCase() === srclang)

  const reset = () => {
    setOpen(false)
    setFile(null)
    setLabel('')
    setOther('')
    setTried(false)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const submit = async () => {
    setTried(true)
    setError('')
    if (fileErr || langErr || !file) return
    const content = await file.text()
    if (!content.includes('-->')) return setError("That doesn't look like an .srt or .vtt subtitle file.")
    const name = label.trim() || LANGUAGES.find((l) => l.code === srclang)?.label || srclang
    add.mutate({ srclang, label: name, content }, { onSuccess: reset, onError: (e) => setError(errText(e)) })
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-text"><Captions className="size-4" aria-hidden /></span>
          <div className="min-w-0">
            <h3 id={`${uid}-h`} className="text-sm font-semibold">Subtitles <span className="font-normal text-muted">(optional)</span></h3>
            <p className="text-xs text-muted">Upload subtitle files to add captions to your video.</p>
          </div>
        </div>
        {readOnly || open ? null : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}><Plus /> Add subtitle</Button>
        )}
      </div>

      {captions.length ? (
        <ul className="stagger grid gap-1.5">
          {captions.map((c) => (
            <li key={c.srclang} className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-sm">
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.label || c.srclang}</span>
              <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-text uppercase">{c.srclang}</span>
              {readOnly ? null : (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${c.label || c.srclang} subtitles`}
                  loading={remove.isPending && remove.variables === c.srclang}
                  onClick={() => window.confirm(`Remove the ${c.label || c.srclang} subtitles?`) && remove.mutate(c.srclang, { onError: (e) => setError(errText(e)) })}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : open ? null : (
        <p className="text-xs text-muted">No subtitles yet.</p>
      )}

      {open ? (
        // not a <form>: this sits inside the lesson's form
        <div className="animate-reveal grid gap-3 rounded-md border border-dashed border-border-strong p-3" onKeyDown={(e) => e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.preventDefault(), void submit())}>
          <Field label="Subtitle file" hint={file ? `${file.name} · ${fileSize(file.size)}` : '.srt or .vtt, up to 1 MB'} error={tried && fileErr ? fileErr : undefined}>
            {(p) => <input {...p} ref={fileInput} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="block w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-primary-soft-text" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Language" hint={replaces ? 'Replaces the current file for this language.' : undefined}>
              {(p) => (
                <NativeSelect {...p} value={lang} onChange={(e) => setLang(e.target.value)}>
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  <option value="other">Other…</option>
                </NativeSelect>
              )}
            </Field>
            {lang === 'other' ? (
              <Field label="Language code" error={tried && langErr ? langErr : undefined}>
                {(p) => <Input {...p} value={other} maxLength={12} placeholder="e.g. it" onChange={(e) => setOther(e.target.value)} />}
              </Field>
            ) : null}
            <Field label="Name shown to learners" hint="Empty: the language name.">
              {(p) => <Input {...p} value={label} maxLength={60} placeholder={LANGUAGES.find((l) => l.code === lang)?.label ?? ''} onChange={(e) => setLabel(e.target.value)} />}
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            <Button type="button" size="sm" loading={add.isPending} onClick={() => void submit()}>Add subtitle</Button>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p> : null}
    </section>
  )
}
