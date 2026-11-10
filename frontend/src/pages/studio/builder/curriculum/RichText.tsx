import { Bold, Heading2, Italic, Link2, List, ListOrdered } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/** A small rich-text box (bold, italic, heading, lists, links). It writes HTML; the
 * server cleans it (nh3) on save, and what we load back has already been cleaned.
 * Pasting keeps only the text, so nothing foreign comes in with a paste. */
export function RichText({ id, value, onChange, label, placeholder, readOnly, minHeight = 160, describedBy }: {
  id: string
  value: string
  onChange: (html: string) => void
  label: string
  placeholder?: string
  readOnly?: boolean
  minHeight?: number
  describedBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // set the HTML only when it changes from outside (typing must not reset the caret)
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value) el.innerHTML = value
  }, [value])

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    onChange(ref.current?.innerHTML ?? '')
  }
  const link = () => {
    const url = window.prompt('Link address (https://…)', 'https://')
    if (url && /^https:\/\/\S+$/.test(url)) run('createLink', url)
  }

  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-surface shadow-sm transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20', readOnly && 'opacity-80')}>
      {readOnly ? null : (
        <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap gap-0.5 border-b border-border bg-surface-2/60 p-1">
          <Tool label="Bold" onClick={() => run('bold')}><Bold /></Tool>
          <Tool label="Italic" onClick={() => run('italic')}><Italic /></Tool>
          <Tool label="Heading" onClick={() => run('formatBlock', 'h3')}><Heading2 /></Tool>
          <Tool label="Bulleted list" onClick={() => run('insertUnorderedList')}><List /></Tool>
          <Tool label="Numbered list" onClick={() => run('insertOrderedList')}><ListOrdered /></Tool>
          <Tool label="Add link" onClick={link}><Link2 /></Tool>
        </div>
      )}
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-describedby={describedBy}
        aria-readonly={readOnly || undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        tabIndex={0}
        style={{ minHeight }}
        className="max-w-none px-3 py-2.5 text-sm text-text outline-none empty:before:text-subtle empty:before:content-[attr(data-placeholder)] [&_a]:text-primary [&_a]:underline [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
        onInput={(e) => onChange(e.currentTarget.innerHTML === '<br>' ? '' : e.currentTarget.innerHTML)}
        onPaste={(e) => {
          e.preventDefault()
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
        }}
      />
    </div>
  )
}

function Tool({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // keep the selection in the editor while clicking a tool
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-1.5 text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-primary [&_svg]:size-4"
    >
      {children}
    </button>
  )
}
