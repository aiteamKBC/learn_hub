/** Human capital: a member's own HR profile, wellbeing, CPD and qualifications, plus the
 * HR-admin catalogue and per-member editing. Every query is keyed by the company id, so
 * switching company never shows another company's cached data. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { putToAzure } from '@/features/studio/api'
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

export function useMemberQualifications(memberId?: string) {
  return useQuery({
    queryKey: key('people', memberId, 'qualifications'),
    queryFn: () => unwrap(api.GET('/api/v1/hcm/people/{member_id}/qualifications', { params: { path: { member_id: memberId! } } })),
    enabled: !!memberId,
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

/** Upload a certificate straight to Azure and return the asset id to award with:
 * 1) ask the API for a write-only link, 2) PUT the file, 3) hand the id back. */
export async function uploadCertificate(memberId: string, file: File, onProgress?: (pct: number) => void): Promise<string> {
  const ticket = await unwrap(
    api.POST('/api/v1/hcm/people/{member_id}/qualifications/certificate-upload', {
      params: { path: { member_id: memberId } },
      body: { filename: file.name, size_bytes: file.size },
    }),
  )
  await putToAzure(ticket, file, onProgress)
  return ticket.asset_id
}

/** A fresh 1-hour download link for a member-qualification's certificate. */
export function certificateUrl(mqId: string) {
  return unwrap(api.GET('/api/v1/hcm/member-qualifications/{mq_id}/certificate', { params: { path: { mq_id: mqId } } }))
}

// ---------------------------------------------------------------- company development plans
const fetchTrainingPlan = (memberId: string) =>
  unwrap(api.GET('/api/v1/hcm/people/{member_id}/training-plan', { params: { path: { member_id: memberId } } }))

export type TrainingPlan = Awaited<ReturnType<typeof fetchTrainingPlan>>
export type TrainingPlanItem = TrainingPlan['items'][number]

export function useTrainingPlan(memberId?: string) {
  return useQuery({
    queryKey: key('training-plan', memberId),
    queryFn: () => fetchTrainingPlan(memberId!),
    enabled: !!memberId,
  })
}

export function useUpdateTrainingPlan(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['TrainingPlanPatch']) => unwrap(api.PATCH('/api/v1/hcm/people/{member_id}/training-plan', { params: { path: { member_id: memberId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('training-plan', memberId) }),
  })
}

export function useAddTrainingPlanItem(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['TrainingPlanItemIn']) => unwrap(api.POST('/api/v1/hcm/people/{member_id}/training-plan/items', { params: { path: { member_id: memberId } }, body })),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: key('training-plan', memberId) }),
      qc.invalidateQueries({ queryKey: ['compliance', 'person', currentOrgId(), memberId] }),
      qc.invalidateQueries({ queryKey: ['org', 'library', currentOrgId()] }),
    ]),
  })
}

export function useCompleteTrainingPlanItem(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, hours }: { itemId: string; hours: number }) => unwrap(api.POST('/api/v1/hcm/people/{member_id}/training-plan/items/{item_id}/complete', { params: { path: { member_id: memberId, item_id: itemId } }, body: { hours } })),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: key('training-plan', memberId) }),
      qc.invalidateQueries({ queryKey: key('people', memberId) }),
    ]),
  })
}

export function useDeleteTrainingPlanItem(memberId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) => unwrap(api.DELETE('/api/v1/hcm/people/{member_id}/training-plan/items/{item_id}', { params: { path: { member_id: memberId, item_id: itemId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('training-plan', memberId) }),
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

// ---------------------------------------------------------------- wellbeing assessment
/** The wellbeing check-in is a short psychological-capital questionnaire: four
 * measures (hope, confidence, resilience, optimism), five statements each. Each
 * statement is rated on a 5-point agree scale. A few are written "negatively"
 * and scored in reverse (`reverse: true`), so people have to read each one. */

export type WbDimension = 'hope' | 'efficacy' | 'resilience' | 'optimism'

export const WB_DIMENSIONS: { key: WbDimension; label: string; blurb: string }[] = [
  { key: 'hope', label: 'Hope', blurb: 'Seeing routes to your goals, and the drive to pursue them.' },
  { key: 'efficacy', label: 'Confidence', blurb: 'Belief in your ability to take on and do your work.' },
  { key: 'resilience', label: 'Resilience', blurb: 'Bouncing back and carrying on after setbacks.' },
  { key: 'optimism', label: 'Optimism', blurb: 'Expecting good things at work, now and ahead.' },
]

export type WbQuestion = { code: string; dimension: WbDimension; text: string; reverse?: boolean }

/** 20 items, five per measure, in a fixed shuffled order so the measures are
 * interleaved rather than grouped. Reverse-scored items are marked. */
export const WB_QUESTIONS: WbQuestion[] = [
  { code: 'H1', dimension: 'hope', text: 'I can think of several ways to reach my goals at work.' },
  { code: 'C1', dimension: 'efficacy', text: 'I feel confident doing my job well.' },
  { code: 'R1', dimension: 'resilience', text: 'When something goes wrong at work, I bounce back quickly.' },
  { code: 'O1', dimension: 'optimism', text: 'I am optimistic about my future at work.' },
  { code: 'C3', dimension: 'efficacy', text: 'I often doubt whether I can handle hard tasks at work.', reverse: true },
  { code: 'H2', dimension: 'hope', text: 'I feel energised about the goals I am working towards.' },
  { code: 'O3', dimension: 'optimism', text: 'At work, I rarely expect things to go my way.', reverse: true },
  { code: 'R2', dimension: 'resilience', text: 'I can get through tough patches because I have managed hard things before.' },
  { code: 'C2', dimension: 'efficacy', text: 'I feel confident sharing my ideas in meetings.' },
  { code: 'H4', dimension: 'hope', text: 'Lately I cannot see how to move my work forward.', reverse: true },
  { code: 'O2', dimension: 'optimism', text: 'I usually expect things at work to turn out well.' },
  { code: 'R3', dimension: 'resilience', text: 'I find it hard to recover when work does not go to plan.', reverse: true },
  { code: 'H3', dimension: 'hope', text: 'If I hit a dead end on a task, I can find another way around it.' },
  { code: 'C4', dimension: 'efficacy', text: 'I feel confident helping to set goals for my area.' },
  { code: 'O4', dimension: 'optimism', text: 'When things are uncertain at work, I look on the bright side.' },
  { code: 'R4', dimension: 'resilience', text: 'I can handle a lot going on at once at work.' },
  { code: 'H5', dimension: 'hope', text: 'I am meeting the goals I set for myself at work.' },
  { code: 'C5', dimension: 'efficacy', text: 'I feel confident talking about my work to people outside my team.' },
  { code: 'R5', dimension: 'resilience', text: 'I take setbacks at work in my stride.' },
  { code: 'O5', dimension: 'optimism', text: 'I expect good things to come from my work.' },
]

export const WB_SCALE: { value: number; label: string }[] = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' },
]

export type WbAnswers = Record<string, number>

const effective = (q: WbQuestion, raw: number) => (q.reverse ? 6 - raw : raw)

/** Mean of a measure's answered items, mapped from the 1..5 scale to 0..100.
 * Returns null if none of that measure's items are answered. */
export function wbSubscale(answers: WbAnswers, dimension: WbDimension): number | null {
  const items = WB_QUESTIONS.filter((q) => q.dimension === dimension && answers[q.code] != null)
  if (!items.length) return null
  const mean = items.reduce((s, q) => s + effective(q, answers[q.code]), 0) / items.length
  return Math.round(((mean - 1) / 4) * 100)
}

/** The four 0..100 sub-scales plus an overall (their mean). */
export function wbScores(answers: WbAnswers) {
  const subs = WB_DIMENSIONS.map((d) => wbSubscale(answers, d.key) ?? 0)
  const [hope, efficacy, resilience, optimism] = subs
  const overall = Math.round(subs.reduce((s, n) => s + n, 0) / subs.length)
  return { hope, efficacy, resilience, optimism, overall }
}

/** A plain-language band for a 0..100 score, like a quiz result, with a tone
 * shared by `Badge` and `Progress`. */
export function wbBand(score: number): { label: string; tone: 'success' | 'primary' | 'warning' | 'danger' } {
  if (score >= 75) return { label: 'Flourishing', tone: 'success' }
  if (score >= 55) return { label: 'Steady', tone: 'primary' }
  if (score >= 40) return { label: 'Under strain', tone: 'warning' }
  return { label: 'Needs support', tone: 'danger' }
}

/** A member's own check-ins, or any member's for an HR admin (same endpoint). */
export function useMemberWellbeing(memberId?: string) {
  return useQuery({
    queryKey: key('people', memberId, 'wellbeing'),
    queryFn: () => unwrap(api.GET('/api/v1/hcm/people/{member_id}/wellbeing', { params: { path: { member_id: memberId! } } })),
    enabled: !!memberId,
  })
}
