import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Instructor invitations sent from Console > Instructors ("Add instructor").

export function useInstructorInvite(token: string) {
  return useQuery({
    queryKey: ['instructor-invite', token],
    queryFn: () => unwrap(api.GET('/api/v1/identity/instructor-invites/preview', { params: { query: { token } } })),
    enabled: !!token,
    retry: false,
  })
}

/** Accepting makes the signed-in person an approved instructor: their profile (['me']) changes. */
export function useAcceptInstructorInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => unwrap(api.POST('/api/v1/identity/instructor-invites/accept', { body: { token } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
