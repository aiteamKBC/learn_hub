/** Competency and role frameworks: the competency catalogue, role frameworks with
 * versioned approval, a member's evidenced competence and readiness, and department
 * maturity campaigns. Every query is keyed by the company id. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type Competency = S['FwCompetencyOut']
export type Role = S['FwRoleOut']
export type RoleHistory = S['FwHistoryOut']
export type Version = S['FwVersionOut']
export type Requirement = S['FwRequirementOut']
export type Competence = S['FwCompetenceOut']
export type Readiness = S['FwReadinessOut']
export type Recommendation = S['FwRecommendationOut']
export type MaturityFramework = S['FwMaturityFrameworkOut']
export type Campaign = S['FwCampaignOut']
export type CampaignScores = S['FwCampaignScoresOut']

const key = (...parts: unknown[]) => ['frameworks', currentOrgId(), ...parts]

// ---------------------------------------------------------------- competencies

export function useCompetencies(kind?: string, includeArchived = false) {
  return useQuery({
    queryKey: key('competencies', kind ?? 'all', includeArchived),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/competencies', { params: { query: { kind: kind || undefined, include_archived: includeArchived } } })),
  })
}

export function useCreateCompetency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwCompetencyIn']) => unwrap(api.POST('/api/v1/frameworks/competencies', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('competencies') }),
  })
}

export function useCloneCompetency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (competencyId: string) => unwrap(api.POST('/api/v1/frameworks/competencies/{competency_id}/clone', { params: { path: { competency_id: competencyId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('competencies') }),
  })
}

export function useUpdateCompetency() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; body: S['FwCompetencyPatch'] }) => unwrap(api.PATCH('/api/v1/frameworks/competencies/{competency_id}', { params: { path: { competency_id: v.id } }, body: v.body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('competencies') }),
  })
}

// ---------------------------------------------------------------- role frameworks

export function useCourseCompetencies(courseId: string) {
  return useQuery({
    queryKey: key('course', courseId, 'competencies'),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/courses/{course_id}/competencies', { params: { path: { course_id: courseId } } })),
    enabled: !!courseId && !!currentOrgId(),
  })
}

export function useTagCourse(courseId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwCourseTagIn']) => unwrap(api.POST('/api/v1/frameworks/courses/{course_id}/competencies', { params: { path: { course_id: courseId } }, body })),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: key('course', courseId, 'competencies') }),
      qc.invalidateQueries({ queryKey: key('recommendations') }),
      qc.invalidateQueries({ queryKey: key('readiness') }),
      qc.invalidateQueries({ queryKey: key('me', 'competence') }),
    ]),
  })
}

export function useRoles(includeArchived = false) {
  return useQuery({
    queryKey: key('roles', includeArchived),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/roles', { params: { query: { include_archived: includeArchived } } })),
  })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwRoleIn']) => unwrap(api.POST('/api/v1/frameworks/roles', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('roles') }),
  })
}

export function useRole(frameworkId?: string) {
  return useQuery({
    queryKey: key('role', frameworkId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/roles/{framework_id}', { params: { path: { framework_id: frameworkId! } } })),
    enabled: !!frameworkId,
  })
}

export function useRoleHistory(frameworkId?: string) {
  return useQuery({
    queryKey: key('role', frameworkId, 'history'),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/roles/{framework_id}/history', { params: { path: { framework_id: frameworkId! } } })),
    enabled: !!frameworkId,
  })
}

/** Open (or create) the working draft version for a role. Returns the version. */
export function useStartVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (frameworkId: string) => unwrap(api.POST('/api/v1/frameworks/roles/{framework_id}/versions', { params: { path: { framework_id: frameworkId } } })),
    onSuccess: (v) => Promise.all([qc.invalidateQueries({ queryKey: key('roles') }), qc.invalidateQueries({ queryKey: key('role', v.framework_id) }), qc.setQueryData(key('version', v.id), v)]),
  })
}

export function useVersion(versionId?: string) {
  return useQuery({
    queryKey: key('version', versionId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/versions/{version_id}', { params: { path: { version_id: versionId! } } })),
    enabled: !!versionId,
  })
}

export function useUpdateVersion(versionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwVersionPatch']) => unwrap(api.PATCH('/api/v1/frameworks/versions/{version_id}', { params: { path: { version_id: versionId } }, body })),
    onSuccess: (v) => qc.setQueryData(key('version', versionId), v),
  })
}

export function useAddRequirement(versionId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwRequirementIn']) => unwrap(api.POST('/api/v1/frameworks/versions/{version_id}/requirements', { params: { path: { version_id: versionId } }, body })),
    onSuccess: (v) => qc.setQueryData(key('version', versionId), v),
  })
}

/** The approval workflow: submit a draft, then approve or send it back. */
export function useVersionTransition(versionId: string, action: 'submit' | 'approve' | 'request-changes') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comment: string) => unwrap(api.POST(`/api/v1/frameworks/versions/{version_id}/${action}` as '/api/v1/frameworks/versions/{version_id}/submit', { params: { path: { version_id: versionId } }, body: { comment } })),
    onSuccess: (v) => {
      qc.setQueryData(key('version', versionId), v)
      void qc.invalidateQueries({ queryKey: key('role', v.framework_id) })
      void qc.invalidateQueries({ queryKey: key('roles') })
      void qc.invalidateQueries({ queryKey: key('readiness', versionId) })
      void qc.invalidateQueries({ queryKey: key('recommendations', versionId) })
    },
  })
}

// ---------------------------------------------------------------- my competence

export function useMyCompetence() {
  return useQuery({ queryKey: key('me', 'competence'), queryFn: () => unwrap(api.GET('/api/v1/frameworks/me/competence')) })
}

export function useReadiness(versionId?: string) {
  return useQuery({
    queryKey: key('readiness', versionId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/versions/{version_id}/readiness', { params: { path: { version_id: versionId! } } })),
    enabled: !!versionId,
  })
}

export function useRecommendations(versionId?: string) {
  return useQuery({
    queryKey: key('recommendations', versionId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/versions/{version_id}/recommendations', { params: { path: { version_id: versionId! } } })),
    enabled: !!versionId,
  })
}

// ---------------------------------------------------------------- department maturity

export function useMaturityFrameworks(kind?: string) {
  return useQuery({
    queryKey: key('maturity', kind ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/maturity/frameworks', { params: { query: { kind: kind || undefined } } })),
  })
}

export function useMaturityVersion(versionId?: string) {
  return useQuery({
    queryKey: key('maturity-version', versionId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/maturity/versions/{version_id}', { params: { path: { version_id: versionId! } } })),
    enabled: !!versionId,
  })
}

export function useCampaigns(dept?: string) {
  return useQuery({
    queryKey: key('campaigns', dept ?? 'all'),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/maturity/campaigns', { params: { query: { dept: dept || undefined } } })),
  })
}

export function useCreateCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['FwCampaignIn']) => unwrap(api.POST('/api/v1/frameworks/maturity/campaigns', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('campaigns') }),
  })
}

export function useCloseCampaign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (campaignId: string) => unwrap(api.POST('/api/v1/frameworks/maturity/campaigns/{campaign_id}/close', { params: { path: { campaign_id: campaignId } } })),
    onSuccess: (_r, campaignId) => Promise.all([qc.invalidateQueries({ queryKey: key('campaigns') }), qc.invalidateQueries({ queryKey: key('scores', campaignId) })]),
  })
}

export function useCampaignScores(campaignId?: string, enabled = true) {
  return useQuery({
    queryKey: key('scores', campaignId),
    queryFn: () => unwrap(api.GET('/api/v1/frameworks/maturity/campaigns/{campaign_id}/scores', { params: { path: { campaign_id: campaignId! } } })),
    enabled: !!campaignId && enabled,
  })
}

export function useSubmitResponse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { campaignId: string; body: S['FwResponseIn'] }) => unwrap(api.POST('/api/v1/frameworks/maturity/campaigns/{campaign_id}/responses', { params: { path: { campaign_id: v.campaignId } }, body: v.body })),
    onSuccess: (_result, variables) => Promise.all([qc.invalidateQueries({ queryKey: key('campaigns') }), qc.invalidateQueries({ queryKey: key('scores', variables.campaignId) })]),
  })
}

// ---------------------------------------------------------------- shared labels

export const KIND_LABEL: Record<string, { label: string; tone: 'primary' | 'info' | 'success' | 'warning' }> = {
  K: { label: 'Knowledge', tone: 'info' },
  S: { label: 'Skill', tone: 'primary' },
  B: { label: 'Behaviour', tone: 'success' },
  P: { label: 'Professional', tone: 'warning' },
  knowledge: { label: 'Knowledge', tone: 'info' },
  skill: { label: 'Skill', tone: 'primary' },
  behaviour: { label: 'Behaviour', tone: 'success' },
  professional: { label: 'Professional', tone: 'warning' },
}

export const REQUIREMENT_KIND_OPTIONS = [
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'skill', label: 'Skill' },
  { value: 'behaviour', label: 'Behaviour' },
  { value: 'professional', label: 'Professional' },
]

export const KIND_OPTIONS = [
  { value: 'K', label: 'Knowledge' },
  { value: 'S', label: 'Skill' },
  { value: 'B', label: 'Behaviour' },
  { value: 'P', label: 'Professional' },
]

export const VERSION_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting review', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  superseded: { label: 'Superseded', tone: 'info' },
}

export const PRIORITY_OPTIONS = [
  { value: 'essential', label: 'Essential' },
  { value: 'important', label: 'Important' },
  { value: 'desirable', label: 'Desirable' },
]
export const PRIORITY_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = { essential: 'danger', important: 'warning', desirable: 'neutral' }
