import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The learner layout puts a page-title band above both columns and shares the
 * band's DOM node here. `undefined` means we're not inside the learner layout
 * (so headers render inline); `null` means the band isn't mounted yet. */
export const LearnerHeaderSlotContext = createContext<HTMLElement | null | undefined>(undefined)

/** Renders page-title content into the learner layout's top band when inside it,
 * so the sidebar and the page body line up below the title. Elsewhere it renders
 * its children inline, unchanged. */
export function LearnerHeader({ children }: { children: ReactNode }) {
  const slot = useContext(LearnerHeaderSlotContext)
  if (slot === undefined) return <>{children}</>
  if (slot === null) return null
  return createPortal(children, slot)
}
