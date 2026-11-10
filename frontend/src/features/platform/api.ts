import { useQuery } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'

// Platform-wide settings everyone may read (console > Settings): branding and the
// switches the backend enforces. Defaults match the backend registry, so the site looks
// right before the first answer arrives.

export type PublicSettings = {
  'general.platform_name': string
  'general.tagline': string
  'general.logo_url': string
  'general.favicon_url': string
  'general.default_language': string
  'general.default_currency': string
  'general.time_zone': string
  'general.date_format': string
  'access.registration_enabled': boolean
  'access.instructor_applications': boolean
  'access.guest_browsing': boolean
  'access.maintenance_mode': boolean
  'access.maintenance_message': string
  'security.mfa_enabled': boolean
  'security.password_min_length': number
}

export const DEFAULT_SETTINGS: PublicSettings = {
  'general.platform_name': 'LearnHub',
  'general.tagline': 'Learn. Practise. Grow.',
  'general.logo_url': '',
  'general.favicon_url': '',
  'general.default_language': 'en',
  'general.default_currency': 'GBP',
  'general.time_zone': 'Europe/London',
  'general.date_format': 'd MMM yyyy',
  'access.registration_enabled': true,
  'access.instructor_applications': true,
  'access.guest_browsing': true,
  'access.maintenance_mode': false,
  'access.maintenance_message': "We're making improvements and will be back shortly.",
  'security.mfa_enabled': true,
  'security.password_min_length': 8,
}

export function usePublicSettings() {
  const q = useQuery({
    queryKey: ['platform', 'settings'],
    queryFn: () => unwrap(api.GET('/api/v1/platform/settings')),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  const settings = { ...DEFAULT_SETTINGS, ...(q.data as Partial<PublicSettings> | undefined) }
  return { settings, isLoading: q.isLoading }
}

/** The platform name for headings and page titles ("LearnHub" until changed). */
export function usePlatformName() {
  return usePublicSettings().settings['general.platform_name']
}

export function useSiteBanner() {
  return useQuery({
    queryKey: ['platform', 'banner'],
    queryFn: () => unwrap(api.GET('/api/v1/platform/banner')),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
}
