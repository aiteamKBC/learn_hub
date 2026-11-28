import { Award, CalendarCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CountUp } from '@/components/ui/count-up'
import { EmptyState, ErrorState, PageHeader, StatCard } from '@/components/ui/misc'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useStudioCertificates } from '@/features/studio/api'
import { shortDate } from '@/lib/format'
import { Link } from '@/lib/router'

/** Certificates learners have earned on the instructor's courses. */
export function CertificatesPage() {
  const { data, isLoading, error, refetch } = useStudioCertificates()

  return (
    <div className="min-w-0">
      <PageHeader title="Certificates" description="Certificates your learners have earned by completing your courses." />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />
      ) : !data ? null : (
        <>
          <div className="animate-reveal grid gap-4 sm:grid-cols-2">
            <StatCard label="Certificates issued" icon={<Award />} value={<CountUp value={data.total} />} hint="All time, across your courses" />
            <StatCard label="This month" tone="success" icon={<CalendarCheck />} value={<CountUp value={data.this_month} />} hint="Earned since the 1st" />
          </div>

          <Card className="mt-6">
            <CardHeader title="Recent certificates" description="The latest learners to complete one of your courses." />
            <CardBody>
              {data.recent.length === 0 ? (
                <EmptyState
                  icon={<Award />}
                  title="No certificates yet"
                  body="When a learner finishes one of your courses, their certificate appears here."
                  className="py-8"
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Learner</Th>
                      <Th>Course</Th>
                      <Th>Issued</Th>
                      <Th>Code</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((c) => (
                      <Tr key={c.id}>
                        <Td className="font-medium">
                          {c.recipient_name}
                          {c.revoked ? <Badge tone="danger" className="ml-2">Revoked</Badge> : null}
                        </Td>
                        <Td className="max-w-72">
                          <span className="block truncate">{c.course_title}</span>
                        </Td>
                        <Td className="whitespace-nowrap text-muted tabular">{shortDate(c.issued_at)}</Td>
                        <Td>
                          <Link to={`/verify/${c.verification_code}`} className="font-mono text-xs text-primary hover:underline">
                            {c.verification_code}
                          </Link>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
