import type { KeyboardEvent } from 'react'

/**
 * Keyboard for a custom `role="radiogroup"` of `role="radio"` buttons (roving tabindex):
 * only the checked option (or the first, when none is) sits in the Tab order, and the
 * arrow keys, Home and End move to another option and choose it.
 *
 *   <button role="radio" aria-checked={on} tabIndex={radioTabIndex(i, checkedIndex)}
 *     onKeyDown={(e) => radioKeyDown(e, i, options.length, (j) => choose(options[j]))} />
 */
export const radioTabIndex = (index: number, checkedIndex: number) => (index === (checkedIndex < 0 ? 0 : checkedIndex) ? 0 : -1)

export function radioKeyDown(e: KeyboardEvent<HTMLElement>, index: number, count: number, select: (index: number) => void) {
  const next =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? (index + 1) % count
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? (index - 1 + count) % count
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? count - 1
            : null
  if (next === null) return
  e.preventDefault()
  select(next)
  const radios = e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]')
  radios?.[next]?.focus()
}
