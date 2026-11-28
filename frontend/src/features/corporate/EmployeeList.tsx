/**
 * The employees who get a recorded-course seat: typed in one by one (email, name, job
 * title) or read from a CSV file saved from Excel. Used while buying seats and on the
 * Seats page; both send the same rows, and the server checks them again.
 */
import { Download, FileUp, Mail, UserPlus, X } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

import type { SeatEmployee } from './api'

export type EntryMode = 'manual' | 'csv'
/** name@domain.tld: the same shape the server accepts. */
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;.]{2,}$/
export const isEmail = (v: string) => EMAIL.test(v.trim())
const blank = (): SeatEmployee => ({ email: '', full_name: '', job_title: '' })

/** A CSV with a header row: email (required), name, job title. Commas or semicolons;
 * quoted cells may hold either. */
export function parseCsv(text: string): { rows: SeatEmployee[]; error?: string } {
  const lines: string[][] = []
  let cell = ''
  let row: string[] = []
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',' || ch === ';') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) lines.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) lines.push(row)
  if (lines.length < 2) return { rows: [], error: 'The file needs a header row and at least one employee.' }
  const head = lines[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''))
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const e = col('email', 'emailaddress', 'workemail')
  if (e < 0) return { rows: [], error: 'Add a column called "email".' }
  const n = col('name', 'fullname', 'employeename')
  const j = col('jobtitle', 'title', 'jobrole', 'role', 'position')
  return {
    rows: lines.slice(1).filter((r) => r.some((c) => c.trim())).map((r) => ({ email: (r[e] ?? '').trim(), full_name: n >= 0 ? (r[n] ?? '').trim() : '', job_title: j >= 0 ? (r[j] ?? '').trim() : '' })),
  }
}

function downloadTemplate(seats: number) {
  const lines = ['email,name,job title', ...Array.from({ length: Math.max(1, Math.min(seats, 500)) }, () => ',,')]
  // BOM so Excel opens it as UTF-8 (names with accents stay correct)
  const blob = new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'employees-template.csv' })
  a.click()
  URL.revokeObjectURL(a.href)
}

/** State + UI. `rows` holds only the filled-in employees for the chosen mode. */
export function useEmployeeEntry(max: number) {
  const [mode, setMode] = useState<EntryMode>('manual')
  const [list, setList] = useState<SeatEmployee[]>([blank()])
  const [file, setFile] = useState<{ name: string; rows: SeatEmployee[]; error?: string } | null>(null)
  const typed = mode === 'manual' ? list.filter((r) => r.email.trim()) : (file?.rows ?? [])
  // only well-formed emails count as added; the rest are shown as mistakes to fix
  const rows = typed.filter((r) => isEmail(r.email))
  const wrong = typed.filter((r) => !isEmail(r.email))
  const invalid = wrong.length > 0
  const tooMany = rows.length > max
  const reset = () => (setList([blank()]), setFile(null))
  const set = (i: number, k: keyof SeatEmployee, v: string) => setList((l) => l.map((r, n) => (n === i ? { ...r, [k]: v } : r)))

  const ui: ReactNode = (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="How to add employees" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {(['manual', 'csv'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors duration-200', mode === m ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}>
            {m === 'manual' ? <Mail className="size-4" /> : <FileUp className="size-4" />}
            {m === 'manual' ? 'Type them in' : 'Upload a file'}
          </button>
        ))}
      </div>
      {mode === 'manual' ? (
        <div className="grid max-h-72 gap-2 overflow-y-auto pr-0.5">
          {list.map((r, i) => (
            <fieldset key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
              <legend className="sr-only">Employee {i + 1}</legend>
              <div className="grid gap-1">
                <Input
                  type="email"
                  aria-label={`Employee ${i + 1} email`}
                  aria-invalid={r.email.trim() && !isEmail(r.email) ? true : undefined}
                  aria-describedby={r.email.trim() && !isEmail(r.email) ? `emp-${i}-err` : undefined}
                  className={r.email.trim() && !isEmail(r.email) ? 'border-danger focus-visible:ring-danger/40' : undefined}
                  placeholder="name@company.com"
                  value={r.email}
                  onChange={(e) => set(i, 'email', e.target.value)}
                />
                {r.email.trim() && !isEmail(r.email) ? (
                  <span id={`emp-${i}-err`} className="text-xs text-danger">
                    Enter an email like name@company.com
                  </span>
                ) : null}
              </div>
              <Input aria-label={`Employee ${i + 1} name`} placeholder="Full name" value={r.full_name} onChange={(e) => set(i, 'full_name', e.target.value)} />
              <Input aria-label={`Employee ${i + 1} job title (optional)`} placeholder="Job title (optional)" value={r.job_title} onChange={(e) => set(i, 'job_title', e.target.value)} />
              <Button variant="ghost" size="sm" aria-label={`Remove employee ${i + 1}`} disabled={list.length === 1} onClick={() => setList((l) => l.filter((_, n) => n !== i))}>
                <X />
              </Button>
            </fieldset>
          ))}
          <Button variant="secondary" size="sm" className="justify-self-start" disabled={list.length >= max} onClick={() => setList((l) => [...l, blank()])}>
            <UserPlus /> Add another
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <ol className="grid gap-1.5 rounded-lg bg-surface-2 p-3 text-sm">
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">1.</span> Download the template ({max} {max === 1 ? 'row' : 'rows'}, one per seat).
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => downloadTemplate(max)}>
                <Download /> Download template
              </Button>
            </li>
            <li>
              <span className="font-medium">2.</span> Fill in each employee's email, name and job title (optional) in Excel.
            </li>
            <li>
              <span className="font-medium">3.</span> Save it as CSV and upload it below.
            </li>
          </ol>
          <label className="grid cursor-pointer place-items-center gap-1 rounded-lg border border-dashed border-border-strong p-5 text-center text-sm transition-colors duration-200 hover:border-primary">
            <FileUp className="size-5 text-primary" />
            <span className="font-medium">{file ? file.name : 'Choose a CSV file'}</span>
            <span className="text-xs text-muted">In Excel: File › Save as › CSV. Columns: email, name, job title.</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (f.size > 1_000_000) return setFile({ name: f.name, rows: [], error: 'The file is too large (1 MB at most).' })
                void f.text().then((t) => setFile({ name: f.name, ...parseCsv(t) }))
              }}
            />
          </label>
          {file?.error ? <p className="text-sm text-danger">{file.error}</p> : null}
          {file && !file.error ? (
            <p className="text-sm text-muted">
              {file.rows.length} {file.rows.length === 1 ? 'employee' : 'employees'} found
              {file.rows.length ? `: ${file.rows.slice(0, 3).map((r) => r.email).join(', ')}${file.rows.length > 3 ? '…' : ''}` : ''}
            </p>
          ) : null}
        </div>
      )}
      {mode === 'csv' && invalid ? (
        <p className="text-sm text-danger">
          {wrong.length} {wrong.length === 1 ? 'row has' : 'rows have'} a wrong email: {wrong.slice(0, 3).map((r) => r.email || '(empty)').join(', ')}
          {wrong.length > 3 ? '…' : ''}. Fix the file and upload it again.
        </p>
      ) : null}
      {tooMany ? (
        <p className="text-sm text-danger">
          {rows.length} people for {max} {max === 1 ? 'seat' : 'seats'}. Remove some people or add seats.
        </p>
      ) : null}
    </div>
  )
  return { mode, rows, tooMany, invalid, reset, ui }
}
