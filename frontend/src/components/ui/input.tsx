import * as RSelect from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { type ChangeEvent, Children, forwardRef, type InputHTMLAttributes, isValidElement, type LabelHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react'

import { cn } from '@/lib/cn'

const field =
  'w-full rounded-md border border-border bg-surface px-3 text-sm text-text shadow-sm transition-colors placeholder:text-subtle hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }>(
  function Input({ className, icon, ...props }, ref) {
    const searchLabel = String(props['aria-label'] ?? props.placeholder ?? '')
    const isSearch = props.type === 'search' || /^search\b/i.test(searchLabel)
    if (!icon) return <input ref={ref} className={cn(field, 'h-10', isSearch && 'rounded-full', className)} {...props} />
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle [&_svg]:size-4">
          {icon}
        </span>
        <input ref={ref} className={cn(field, 'h-10 pl-9', isSearch && 'rounded-full', className)} {...props} />
      </div>
    )
  },
)

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-24 py-2.5', className)} {...props} />
}

// Radix forbids an empty-string item value, so "" (our "No unit" / "Any" options) maps to a
// private sentinel and maps back on change — callers keep seeing "" exactly as before.
const SELECT_NONE = '__none__'
const toItemValue = (v: unknown) => (v === '' || v == null ? SELECT_NONE : String(v))
const fromItemValue = (v: string) => (v === SELECT_NONE ? '' : v)

type SelectOption = { value: string; label: ReactNode; disabled?: boolean }
function collectOptions(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'optgroup') {
      out.push(...collectOptions((child.props as { children?: ReactNode }).children))
      return
    }
    if (child.type !== 'option') return
    const p = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
    out.push({ value: toItemValue(p.value === undefined ? p.children : p.value), label: p.children, disabled: p.disabled })
  })
  return out
}

/** Select with the same API as a native <select> (value/defaultValue, onChange with
 * e.target.value, <option> children), but the list that opens is our own themed listbox,
 * so every dropdown across the app matches the scheme in light and dark mode, is keyboard
 * reachable and animates like the other menus. Drop-in: no call site has to change. */
export function NativeSelect({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  name,
  id,
  title,
  autoFocus,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = collectOptions(children)
  const controlled = value !== undefined
  // uncontrolled with no default selects the first option, exactly as a native <select> does
  const rootDefault = defaultValue !== undefined ? toItemValue(defaultValue) : controlled ? undefined : options[0]?.value
  const emit = (v: string) => onChange?.({ target: { value: fromItemValue(v) } } as unknown as ChangeEvent<HTMLSelectElement>)

  return (
    <RSelect.Root value={controlled ? toItemValue(value) : undefined} defaultValue={rootDefault} onValueChange={emit} disabled={disabled} required={required} name={name}>
      <RSelect.Trigger
        id={id}
        title={title}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cn(field, 'flex h-10 items-center justify-between gap-2 overflow-hidden text-left [&>svg]:transition-transform data-[placeholder]:text-subtle data-[state=open]:[&>svg]:rotate-180', className)}
      >
        <RSelect.Value placeholder="Select…" />
        <RSelect.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-primary" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg data-[state=closed]:animate-menu-out data-[state=open]:animate-menu-in"
        >
          <RSelect.ScrollUpButton className="flex h-6 cursor-default items-center justify-center text-muted">
            <ChevronUp className="size-4" />
          </RSelect.ScrollUpButton>
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default items-center rounded-md py-2 pr-8 pl-2.5 text-sm text-text outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium data-[state=checked]:text-primary"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2.5 inline-flex items-center text-primary">
                  <Check className="size-4" />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
          <RSelect.ScrollDownButton className="flex h-6 cursor-default items-center justify-center text-muted">
            <ChevronDown className="size-4" />
          </RSelect.ScrollDownButton>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium text-text', className)} {...props} />
}

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode
}) {
  const id = useId()
  const describedBy = error || hint ? `${id}-desc` : undefined
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={describedBy} className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
