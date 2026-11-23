import { ChevronRight, Search, Users } from 'lucide-react'
import { useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { ROLE_LABEL, usePeople } from '@/features/org/api'
import { useDebounced } from '@/features/org/ui'
import { Link, useNavigate } from '@/lib/router'

export function HrPeoplePage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const debounced = useDebounced(q)
  const people = usePeople({ q: debounced })
  const rows = people.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <>
      <PageHeader title="People (HR)" description="Open a person to view and update their HR profile, and to award a qualification." />
      <Card>
        <div className="border-b border-border p-4">
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search people" type="search" className="sm:max-w-sm" />
        </div>
        {people.error ? (
          <ErrorState message={(people.error as Error).message} onRetry={() => void people.refetch()} />
        ) : people.isLoading ? (
          <div className="grid gap-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={debounced ? <Search /> : <Users />} title={debounced ? 'Nobody matches' : 'No people yet'} body={debounced ? 'Try another name or clear the search.' : 'People in your company will appear here.'} />
        ) : (
          <div className="animate-reveal">
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th className="hidden sm:table-cell">Job title</Th>
                  <Th className="hidden md:table-cell">Units</Th>
                  <Th>Role</Th>
                  <Th className="text-right">
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((p) => (
                  <Tr key={p.member_id} className="cursor-pointer" onClick={() => navigate(`/business/hcm/people/${p.member_id}`)}>
                    <Td>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={p.name || p.email} size="sm" />
                        <div className="min-w-0">
                          <Link to={`/business/hcm/people/${p.member_id}`} className="block truncate font-medium hover:text-primary" onClick={(e) => e.stopPropagation()}>
                            {p.name || p.email}
                          </Link>
                          <p className="max-w-[16rem] truncate text-xs text-muted">{p.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden max-w-[12rem] truncate text-muted sm:table-cell">{p.job_title || '–'}</Td>
                    <Td className="hidden max-w-[12rem] truncate text-muted md:table-cell">{p.units.join(', ') || '–'}</Td>
                    <Td className="text-muted">{ROLE_LABEL[p.role] ?? p.role}</Td>
                    <Td className="text-right">
                      <ChevronRight className="ml-auto size-4 text-subtle" aria-hidden />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted">
              <span>
                Showing {rows.length} {rows.length === 1 ? 'person' : 'people'}
              </span>
              {people.hasNextPage ? (
                <Button variant="secondary" size="sm" loading={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
                  Load more
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </>
  )
}
