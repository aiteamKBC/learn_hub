import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Console > Settings: every platform setting from the backend registry, saved together.

export function useConsoleSettings() {
  return useQuery({ queryKey: ['console', 'settings'], queryFn: () => unwrap(api.GET('/api/v1/console/settings')) })
}
export type SettingDef = NonNullable<ReturnType<typeof useConsoleSettings>['data']>['settings'][number]
export type SettingValue = string | number | boolean

function useDone() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['console', 'settings'] }),
      qc.invalidateQueries({ queryKey: ['platform', 'settings'] }), // branding and switches site-wide
      qc.invalidateQueries({ queryKey: ['cart'] }), // canonical promotion-stacking changes
    ])
}

export function useSaveSettings() {
  const done = useDone()
  return useMutation({
    mutationFn: (values: Record<string, SettingValue>) => unwrap(api.PUT('/api/v1/console/settings', { body: { values } })),
    onSuccess: done,
  })
}

export type BrandingKind = 'logo' | 'favicon'

/** Upload a logo or favicon straight to private storage, then switch the site to it. */
export function useBrandingUpload() {
  const done = useDone()
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: BrandingKind; file: File }) => {
      const t = await unwrap(api.POST('/api/v1/console/settings/branding/{kind}/upload', { params: { path: { kind } }, body: { filename: file.name, size_bytes: file.size } }))
      const res = await fetch(t.upload_url, { method: t.method, headers: t.headers, body: file })
      if (!res.ok) throw new Error('The upload failed. Try again.')
      return unwrap(api.POST('/api/v1/console/settings/branding/{kind}/confirm', { params: { path: { kind } }, body: { key: t.key } }))
    },
    onSuccess: done,
  })
}

export function useBrandingRemove() {
  const done = useDone()
  return useMutation({
    mutationFn: (kind: BrandingKind) => unwrap(api.POST('/api/v1/console/settings/branding/{kind}/remove', { params: { path: { kind } } })),
    onSuccess: done,
  })
}

export function usePlatformStaff() {
  return useQuery({ queryKey: ['console', 'settings', 'staff'], queryFn: () => unwrap(api.GET('/api/v1/console/settings/staff')) })
}

function useStaffChanged() {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: ['console', 'settings', 'staff'] })
}

export function useGrantPlatformStaff() {
  const done = useStaffChanged()
  return useMutation({ mutationFn: (email: string) => unwrap(api.POST('/api/v1/console/settings/staff', { body: { email } })), onSuccess: done })
}

export function useRemovePlatformStaff() {
  const done = useStaffChanged()
  return useMutation({ mutationFn: (id: string) => unwrap(api.POST('/api/v1/console/settings/staff/{user_id}/remove', { params: { path: { user_id: id } } })), onSuccess: done })
}

export function useIntegrationHealth() {
  return useQuery({ queryKey: ['console', 'settings', 'integrations'], queryFn: () => unwrap(api.GET('/api/v1/console/health')), refetchInterval: 60_000 })
}
