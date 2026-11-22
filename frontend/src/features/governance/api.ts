/** Governance: company strategy (vision, mission, values, objectives, versioned and
 * approved), policy documents and SOPs (with an allocation rule and member adoption),
 * and the technical question bank. Keyed by the current org id. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { components } from '@/api/schema'
import { currentOrgId } from '@/lib/workspace'

type S = components['schemas']
export type Strategy = S['GovStrategyOut']
export type StrategyVersion = S['GovStrategyVersionOut']
export type GovObjective = S['GovObjectiveOut']
export type VersionPatch = S['GovVersionPatch']
export type ObjectiveIn = S['GovObjectiveIn']
export type Policy = S['GovPolicyOut']
export type PolicyIn = S['GovPolicyIn']
export type PolicyVersion = S['GovPolicyVersionOut']
export type PolicyVersionPatch = S['GovPolicyVersionPatch']
export type Allocation = S['GovAllocationOut']
export type AllocationIn = S['GovAllocationIn']
export type PolicyRecord = S['GovRecordOut']
export type Question = S['GovQuestionOut']
export type QuestionIn = S['GovQuestionIn']
export type QuestionPatch = S['GovQuestionPatch']

/** The understanding check stored on a policy version. */
export type UnderstandingCheck = { question?: string; options?: string[]; answer?: number }
/** A policy section (loose shape; stored as free JSON). */
export type PolicySection = { heading?: string; body?: string }

/** Older imported policies use [heading, paragraphs] sections and `q` for the question. */
export function policySections(value: unknown): PolicySection[] {
  if (!Array.isArray(value)) return []
  return value.map((section: unknown) => {
    if (Array.isArray(section)) return { heading: String(section[0] ?? ''), body: Array.isArray(section[1]) ? section[1].map(String).join('\n\n') : String(section[1] ?? '') }
    if (section && typeof section === 'object') {
      const item = section as Record<string, unknown>
      return { heading: String(item.heading ?? ''), body: Array.isArray(item.body) ? item.body.map(String).join('\n\n') : String(item.body ?? '') }
    }
    return { body: String(section ?? '') }
  })
}

export function policyCheck(value: unknown): UnderstandingCheck {
  if (!value || typeof value !== 'object') return {}
  const check = value as Record<string, unknown>
  return { question: String(check.question ?? check.q ?? ''), options: Array.isArray(check.options) ? check.options.map(String) : [], answer: typeof check.answer === 'number' ? check.answer : undefined }
}

const key = (...parts: unknown[]) => ['governance', currentOrgId(), ...parts]

// ---------------------------------------------------------------- strategy
export function useStrategies() {
  return useQuery({ queryKey: key('strategies'), queryFn: () => unwrap(api.GET('/api/v1/governance/strategies')) })
}

export function useCreateStrategy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => unwrap(api.POST('/api/v1/governance/strategies', { body: { name } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('strategies') }),
  })
}

export function useStrategyVersions(sid?: string) {
  return useQuery({
    queryKey: key('strategy', sid, 'versions'),
    queryFn: () => unwrap(api.GET('/api/v1/governance/strategies/{sid}/versions', { params: { path: { sid: sid! } } })),
    enabled: !!sid,
  })
}

function invalidateStrategy(qc: ReturnType<typeof useQueryClient>, sid?: string) {
  return Promise.all([qc.invalidateQueries({ queryKey: key('strategies') }), sid ? qc.invalidateQueries({ queryKey: key('strategy', sid, 'versions') }) : Promise.resolve()])
}

export function useUpdateStrategyVersion(vid: string, sid?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: VersionPatch) => unwrap(api.PATCH('/api/v1/governance/strategy-versions/{vid}', { params: { path: { vid } }, body })),
    onSuccess: () => invalidateStrategy(qc, sid),
  })
}

export function useAddStrategyObjective(vid: string, sid?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ObjectiveIn) => unwrap(api.POST('/api/v1/governance/strategy-versions/{vid}/objectives', { params: { path: { vid } }, body })),
    onSuccess: () => invalidateStrategy(qc, sid),
  })
}

export function useApproveStrategyVersion(vid: string, sid?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/governance/strategy-versions/{vid}/approve', { params: { path: { vid } } })),
    onSuccess: () => invalidateStrategy(qc, sid),
  })
}

// ---------------------------------------------------------------- policies
export function usePolicies(docType?: string, includeArchived = false) {
  return useQuery({
    queryKey: key('policies', docType ?? 'all', includeArchived),
    queryFn: () => unwrap(api.GET('/api/v1/governance/policies', { params: { query: { doc_type: docType || undefined, include_archived: includeArchived } } })),
  })
}

export function usePolicy(pid?: string) {
  return useQuery({
    queryKey: key('policy', pid),
    queryFn: () => unwrap(api.GET('/api/v1/governance/policies/{pid}', { params: { path: { pid: pid! } } })),
    enabled: !!pid,
  })
}

export function useCreatePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PolicyIn) => unwrap(api.POST('/api/v1/governance/policies', { body })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'governance' && q.queryKey[2] === 'policies' }),
  })
}

export function usePolicyVersions(pid?: string) {
  return useQuery({
    queryKey: key('policy', pid, 'versions'),
    queryFn: () => unwrap(api.GET('/api/v1/governance/policies/{pid}/versions', { params: { path: { pid: pid! } } })),
    enabled: !!pid,
  })
}

function invalidatePolicy(qc: ReturnType<typeof useQueryClient>, pid: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: key('policy', pid) }),
    qc.invalidateQueries({ queryKey: key('policy', pid, 'versions') }),
    qc.invalidateQueries({ queryKey: key('policies') }),
    qc.invalidateQueries({ queryKey: key('my-policies') }),
  ])
}

export function useStartPolicyVersion(pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/governance/policies/{pid}/versions', { params: { path: { pid } } })),
    onSuccess: () => invalidatePolicy(qc, pid),
  })
}

export function useUpdatePolicyVersion(vid: string, pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PolicyVersionPatch) => unwrap(api.PATCH('/api/v1/governance/policy-versions/{vid}', { params: { path: { vid } }, body })),
    onSuccess: () => invalidatePolicy(qc, pid),
  })
}

export function useApprovePolicyVersion(vid: string, pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/governance/policy-versions/{vid}/approve', { params: { path: { vid } } })),
    onSuccess: () => invalidatePolicy(qc, pid),
  })
}

export function useAllocation(pid?: string) {
  return useQuery({
    queryKey: key('policy', pid, 'allocation'),
    queryFn: () => unwrap(api.GET('/api/v1/governance/policies/{pid}/allocation', { params: { path: { pid: pid! } } })),
    enabled: !!pid,
    retry: false,
  })
}

export function useSetAllocation(pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AllocationIn) => unwrap(api.PUT('/api/v1/governance/policies/{pid}/allocation', { params: { path: { pid } }, body })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: key('policy', pid, 'allocation') }), qc.invalidateQueries({ queryKey: key('policy', pid, 'records') }), qc.invalidateQueries({ queryKey: key('my-policies') })]),
  })
}

export function usePolicyRecords(pid?: string) {
  return useQuery({
    queryKey: key('policy', pid, 'records'),
    queryFn: () => unwrap(api.GET('/api/v1/governance/policies/{pid}/records', { params: { path: { pid: pid! } } })),
    enabled: !!pid,
  })
}

export function useAddObservation(pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: S['GovObservationIn']) => unwrap(api.POST('/api/v1/governance/policies/{pid}/observations', { params: { path: { pid } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key('policy', pid, 'records') }),
  })
}

// ---------------------------------------------------------------- member adoption (learner)
export function useMyPolicies() {
  return useQuery({ queryKey: key('my-policies'), queryFn: () => unwrap(api.GET('/api/v1/governance/me/policies')) })
}

/** Published, allocated member content; the answer key and working drafts stay server-side. */
export function useMyPolicyContent(pid: string) {
  return useQuery({ queryKey: key('my-policy', pid), queryFn: () => unwrap(api.GET('/api/v1/governance/me/policies/{pid}', { params: { path: { pid } } })) })
}

function invalidateMine(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([qc.invalidateQueries({ queryKey: key('my-policies') }), qc.invalidateQueries({ queryKey: key('policy') })])
}

export function useReadPolicy(pid: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/governance/policies/{pid}/read', { params: { path: { pid } } })), onSuccess: () => invalidateMine(qc) })
}

export function useAcknowledgePolicy(pid: string) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => unwrap(api.POST('/api/v1/governance/policies/{pid}/acknowledge', { params: { path: { pid } } })), onSuccess: () => invalidateMine(qc) })
}

export function useSubmitCheck(pid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (answerIndex: number) => unwrap(api.POST('/api/v1/governance/policies/{pid}/check', { params: { path: { pid } }, body: { answer_index: answerIndex } })),
    onSuccess: () => invalidateMine(qc),
  })
}

// ---------------------------------------------------------------- question bank
export function useQuestions(dept?: string, includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: key('questions', dept ?? 'all', includeArchived),
    queryFn: () => unwrap(api.GET('/api/v1/governance/questions', { params: { query: { dept: dept || undefined, include_archived: includeArchived } } })),
    enabled,
  })
}

export function useCreateQuestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: QuestionIn) => unwrap(api.POST('/api/v1/governance/questions', { body })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'governance' && q.queryKey[2] === 'questions' }),
  })
}

export function useUpdateQuestion(qid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: QuestionPatch) => unwrap(api.PATCH('/api/v1/governance/questions/{qid}', { params: { path: { qid } }, body })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'governance' && q.queryKey[2] === 'questions' }),
  })
}

export function useArchiveQuestion(qid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/governance/questions/{qid}/archive', { params: { path: { qid } } })),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'governance' && q.queryKey[2] === 'questions' }),
  })
}

// ---------------------------------------------------------------- shared labels
export const VERSION_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  superseded: { label: 'Superseded', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const POLICY_STATUS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const DOC_TYPE_LABEL: Record<string, string> = { policy: 'Policy', sop: 'SOP' }

export const SCOPE_LABEL: Record<string, string> = { org: 'Everyone', depts: 'Selected departments and people' }

/** Adoption stages: 0 Not started → 4 Embedded. */
export const ADOPTION_STAGES = ['Not started', 'Aware', 'Understands', 'Applies', 'Embedded'] as const
export function adoptionTone(stage: number): 'neutral' | 'info' | 'warning' | 'success' | 'primary' {
  return ['neutral', 'warning', 'info', 'primary', 'success'][Math.max(0, Math.min(4, stage))] as 'neutral' | 'info' | 'warning' | 'success' | 'primary'
}

export const QTYPE_LABEL: Record<string, string> = { mcq: 'Multiple choice', rubric: 'Interview rubric' }
