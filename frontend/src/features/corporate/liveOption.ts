import { useIsOrgAdmin } from '@/features/org/api'

import { type Package, usePackages } from './api'

export type Delivery = 'recorded' | 'live'

/** Whether live training can be asked for on this course: only company admins, and only
 * when the platform has switched live on for the course and given it a price. */
export function useLiveOption(courseId: string | null, enabled: boolean): { pkg?: Package; why?: string; loading: boolean } {
  const admin = useIsOrgAdmin()
  const q = usePackages(enabled && admin)
  if (!admin) return { why: 'Only company admins can ask for live training.', loading: false }
  if (q.isPending) return { loading: true }
  if (q.isError) return { why: 'We could not check live training right now.', loading: false }
  const pkg = (q.data ?? []).find((p) => p.course_id === courseId && p.delivery_type === 'live')
  return pkg ? { pkg, loading: false } : { why: 'Live training is not offered for this course yet.', loading: false }
}
