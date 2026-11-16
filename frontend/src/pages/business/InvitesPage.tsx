import { Navigate } from 'react-router-dom'

/** Invitations now live on the People page (its "Pending invitations" tab). Old links
 * and bookmarks to /business/invites land there. */
export function InvitesPage() {
  return <Navigate to="/business/people?tab=invites" replace />
}
