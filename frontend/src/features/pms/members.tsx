/** A light person picker and a member-id → name lookup, built on the org people search.
 * Kept inside the feature folder so PMS owns it (no cross-feature imports). */
import { useId, useMemo, useState } from 'react'

import { Input, NativeSelect } from '@/components/ui/input'
import { usePeopleSearch } from '@/features/org/api'

/** A map of member id → display name for the whole company (one page of people). */
export function useMemberNames() {
  const { data } = usePeopleSearch('')
  return useMemo(() => new Map((data?.items ?? []).map((p) => [p.member_id, p.name])), [data])
}

export function memberName(names: Map<string, string>, id: string | null | undefined) {
  if (!id) return 'Unassigned'
  return names.get(id) ?? 'A team member'
}

/** A select of company people. value/onChange use the member id; '' means nobody. */
export function MemberSelect({ value, onChange, allowNone = true, noneLabel = 'No owner', id, className, label = 'Owner' }: { value: string; onChange: (v: string) => void; allowNone?: boolean; noneLabel?: string; id?: string; className?: string; label?: string }) {
  const [q, setQ] = useState('')
  const selectId = useId()
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>({})
  const { data } = usePeopleSearch(q)
  const people = data?.items ?? []
  return (
    <div className={className}>
      <Input className="mb-1.5 h-9" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      <NativeSelect id={id ?? selectId} aria-label={label} value={value} onChange={(e) => { const person = people.find((p) => p.member_id === e.target.value); if (person) setSelectedNames((previous) => ({ ...previous, [person.member_id]: person.name })); onChange(e.target.value) }}>
        {allowNone ? <option value="">{noneLabel}</option> : null}
        {value && !people.some((person) => person.member_id === value) ? <option value={value}>{selectedNames[value] ?? 'Selected team member'}</option> : null}
        {people.map((p) => (
          <option key={p.member_id} value={p.member_id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  )
}
