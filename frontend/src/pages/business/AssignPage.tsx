import { Navigate, useLocation, useSearchParams } from 'react-router-dom'

/** Assigning training now happens on the course library, in a side panel. Old links
 * (/business/assign and /business/assign?course=<id>) land there with the panel open,
 * on the right step, and keep any people chosen on the way (router state). */
export function AssignPage() {
  const [params] = useSearchParams()
  const { state } = useLocation()
  const course = params.get('course')
  return <Navigate to={`/business/library?assign=${encodeURIComponent(course || 'new')}`} state={state} replace />
}
