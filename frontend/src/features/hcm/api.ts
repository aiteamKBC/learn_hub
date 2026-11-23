/** Human capital: a member's own HR profile, wellbeing, CPD and qualifications, plus the
 * HR-admin catalogue and per-member editing. Every query is keyed by the company id, so
 * switching company never shows another company's cached data. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type Profile = S['ProfileOut']
export type Wellbeing = S['WellbeingOut']
export type Cpd = S['CpdOut']
export type Qualification = S['QualificationOut']
export type MemberQualification = S['MemberQualificationOut']

const key = (...parts: unknown[]) => ['hcm', currentOrgId(), ...parts]

// ---------------------------------------------------------------- my own record

export function useMyProfile() {
  return useQuery({ queryKey: key('me', 'profile'), queryFn: () => unwrap(api.GET('/api/v1/hcm/me/profile')) })
}

export function useUpdateMyProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['MyProfilePatch']) => unwrap(api.PATCH('/api/v1/hcm/me/profile', { body })),
    onSuccess: (profile) => Promise.all([qc.invalidateQueries({ queryKey: key('me', 'profile') }), qc.invalidateQueries({ queryKey: key('people', profile.member_id) })]),
  })
}

export function useMyWellbeing() {
  return useQuery({ queryKey: key('me', 'wellbeing'), queryFn: () => unwrap(api.GET('/api/v1/hcm/me/wellbeing')) })
}

export function useSubmitWellbeing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['WellbeingIn']) => unwrap(api.POST('/api/v1/hcm/me/wellbeing', { body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('me', 'wellbeing') }), qc.invalidateQueries({ queryKey: key('me', 'profile') })]),
  })
}

export function useMyCpd() {
  return useQuery({ queryKey: key('me', 'cpd'), queryFn: () => unwrap(api.GET('/api/v1/hcm/me/cpd')) })
}

export function useAddCpd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['CpdIn']) => unwrap(api.POST('/api/v1/hcm/me/cpd', { body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('me', 'cpd') }), qc.invalidateQueries({ queryKey: key('me', 'profile') })]),
  })
}

export function useMyQualifications() {
  return useQuery({ queryKey: key('me', 'qualifications'), queryFn: () => unwrap(api.GET('/api/v1/hcm/me/qualifications')) })
}

// ---------------------------------------------------------------- HR-admin catalogue

export function useQualifications(includeArchived = false) {
  return useQuery({
    queryKey: key('qualifications', includeArchived),
    queryFn: () => unwrap(api.GET('/api/v1/hcm/qualifications', { params: { query: { include_archived: includeArchived } } })),
  })
}

export function useCreateQualification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['QualificationIn']) => unwrap(api.POST('/api/v1/hcm/qualifications', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('qualifications') }),
  })
}

// ---------------------------------------------------------------- one member (HR view)

export function useMemberProfile(memberId?: string) {
  return useQuery({
    queryKey: key('people', memberId),
    queryFn: () => unwrap(api.GET('/api/v1/hcm/people/{member_id}/profile', { params: { path: { member_id: memberId! } } })),
    enabled: !!memberId,
  })
}

export function useUpdateHrProfile(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['HrProfilePatch']) => unwrap(api.PATCH('/api/v1/hcm/people/{member_id}/profile', { params: { path: { member_id: memberId } }, body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('people', memberId) }), qc.invalidateQueries({ queryKey: key('me', 'profile') })]),
  })
}

export function useAwardQualification(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['MemberQualificationIn']) => unwrap(api.POST('/api/v1/hcm/people/{member_id}/qualifications', { params: { path: { member_id: memberId } }, body })),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: key('people', memberId) }),
      qc.invalidateQueries({ queryKey: key('me', 'qualifications') }),
      qc.invalidateQueries({ queryKey: ['frameworks', currentOrgId(), 'readiness'] }),
    ]),
  })
}

// ---------------------------------------------------------------- shared labels

/** The four tracks a career can follow. Free text on the server; these are the usual ones. */
export const TRACK_LABEL: Record<string, string> = {
  '': 'Not set',
  ic: 'Individual contributor',
  management: 'Management',
  specialist: 'Specialist',
  support: 'Support',
}

export const CPD_KIND_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  course: 'Course',
  external: 'External learning',
  event: 'Event',
  reading: 'Reading',
  other: 'Other',
}

/** 1 (low) to 5 (high) for the four wellbeing measures. */
export const WELLBEING_SCALE = [1, 2, 3, 4, 5] as const
export const WELLBEING_FIELDS = [
  { name: 'hope', label: 'Hope', help: 'I can see ways to reach my goals at work.' },
  { name: 'efficacy', label: 'Confidence', help: 'I feel able to do my work well.' },
  { name: 'resilience', label: 'Resilience', help: 'I bounce back after setbacks.' },
  { name: 'optimism', label: 'Optimism', help: 'I expect good things at work.' },
  { name: 'overall', label: 'Overall', help: 'How I feel about work just now.' },
] as const
