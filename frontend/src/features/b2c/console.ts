/** Admin (staff) console for B2C monetization: token pricing (packs, rates, top-up policies,
 * bonus campaigns, per-course/-lecture prices, distribution preview, audit) and token-wallet
 * management (user lookup, ledger, mandatory-reason adjustment).
 *
 * Every mutation carries a `reason` the server requires and audits. Nothing here invents a
 * financial rule: policies that an admin hasn't configured are shown as such, and actions the
 * backend blocks (e.g. bonus-campaign activation) surface the block truthfully.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from '@/api/client'
import type { paths } from '@/api/schema'

/** The exact JSON request body type for an operation, taken from the generated schema, so
 * call sites stay in lock-step with the backend contract. */
type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { requestBody: { content: { 'application/json': infer B } } } ? B : never

function useInvalidate(keys: string[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ predicate: (q) => keys.includes(String(q.queryKey[0])) })
}

// ------------------------------------------------------------------ price tiers (for pack pricing)
export function usePriceTiers() {
  return useQuery({ queryKey: ['b2c-admin-tiers'], queryFn: () => unwrap(api.GET('/api/v1/console/price-tiers')), staleTime: 5 * 60_000 })
}

// ------------------------------------------------------------------ token packs
export type PackBody = Body<'/api/v1/console/pricing/token/packs', 'post'>

export function useAdminPacks(includeInactive = true) {
  return useQuery({
    queryKey: ['b2c-admin-packs', includeInactive],
    queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/packs', { params: { query: { include_inactive: includeInactive } } })),
  })
}

export function useCreatePack() {
  const refresh = useInvalidate(['b2c-admin-packs', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (body: PackBody) => unwrap(api.POST('/api/v1/console/pricing/token/packs', { body })),
    onSuccess: refresh,
  })
}

export function useUpdatePack() {
  const refresh = useInvalidate(['b2c-admin-packs', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { packId: string; body: PackBody }) =>
      unwrap(api.PATCH('/api/v1/console/pricing/token/packs/{pack_id}', { params: { path: { pack_id: v.packId } }, body: v.body })),
    onSuccess: refresh,
  })
}

export function useDeletePack() {
  const refresh = useInvalidate(['b2c-admin-packs', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (packId: string) => unwrap(api.DELETE('/api/v1/console/pricing/token/packs/{pack_id}', { params: { path: { pack_id: packId } } })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ token rates
export function useAdminRates() {
  return useQuery({ queryKey: ['b2c-admin-rates'], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/rates')) })
}

export type RateBody = Body<'/api/v1/console/pricing/token/rates', 'post'>

export function useCreateRate() {
  const refresh = useInvalidate(['b2c-admin-rates', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (body: RateBody) => unwrap(api.POST('/api/v1/console/pricing/token/rates', { body })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ top-up policies
export function useAdminTopUpPolicies() {
  return useQuery({ queryKey: ['b2c-admin-topup'], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/topup-policies')) })
}

export type TopUpPolicyBody = Body<'/api/v1/console/pricing/token/topup-policies/{currency}', 'put'>

export function useUpsertTopUpPolicy() {
  const refresh = useInvalidate(['b2c-admin-topup', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { currency: string; body: TopUpPolicyBody }) =>
      unwrap(api.PUT('/api/v1/console/pricing/token/topup-policies/{currency}', { params: { path: { currency: v.currency } }, body: v.body })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ bonus campaigns (activation is backend-gated)
export function useAdminBonusCampaigns() {
  return useQuery({ queryKey: ['b2c-admin-bonus'], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/bonus-campaigns')) })
}

export type BonusBody = Body<'/api/v1/console/pricing/token/bonus-campaigns', 'post'>

export function useCreateBonusCampaign() {
  const refresh = useInvalidate(['b2c-admin-bonus', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (body: BonusBody) => unwrap(api.POST('/api/v1/console/pricing/token/bonus-campaigns', { body })),
    onSuccess: refresh,
  })
}

export function useUpdateBonusCampaign() {
  const refresh = useInvalidate(['b2c-admin-bonus', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { campaignId: string; body: BonusBody }) =>
      unwrap(api.PATCH('/api/v1/console/pricing/token/bonus-campaigns/{campaign_id}', { params: { path: { campaign_id: v.campaignId } }, body: v.body })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ course / lecture token pricing + auto distribution
// The PATCH bodies use UNSET-aware `Any` fields on the backend, so we send a precise partial
// shape and cast at the call (the generated type widens these to `unknown`).
export function useTokenCourses(search: string, page = 1) {
  return useQuery({
    queryKey: ['b2c-admin-tcourses', search, page],
    queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/courses', { params: { query: { search: search || undefined, page } } })),
  })
}

export function useTokenCourse(courseId: string | null) {
  return useQuery({
    queryKey: ['b2c-admin-tcourse', courseId],
    queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/courses/{course_id}', { params: { path: { course_id: courseId! } } })),
    enabled: !!courseId,
  })
}

export type TokenPricingMode = 'manual' | 'auto_weighted'
export type CourseTokenPatch = { price_tier_id?: string | null; full_course_token_price?: number | null; token_pricing_mode?: TokenPricingMode; reason: string }
export type LectureTokenPatch = { token_price?: number | null; is_free_preview?: boolean; confirm?: boolean; reason: string }

export function usePatchTokenCourse() {
  const refresh = useInvalidate(['b2c-admin-tcourses', 'b2c-admin-tcourse', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { courseId: string; body: CourseTokenPatch }) =>
      unwrap(api.PATCH('/api/v1/console/pricing/token/courses/{course_id}', { params: { path: { course_id: v.courseId } }, body: v.body as never })),
    onSuccess: refresh,
  })
}

export function usePatchLecture() {
  const refresh = useInvalidate(['b2c-admin-tcourse', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { lectureId: string; body: LectureTokenPatch }) =>
      unwrap(api.PATCH('/api/v1/console/pricing/token/lectures/{lecture_id}', { params: { path: { lecture_id: v.lectureId } }, body: v.body as never })),
    onSuccess: refresh,
  })
}

export function usePatchMaterial() {
  const refresh = useInvalidate(['b2c-admin-tcourse', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { materialId: string; body: LectureTokenPatch }) =>
      unwrap(api.PATCH('/api/v1/console/pricing/token/materials/{material_id}', { params: { path: { material_id: v.materialId } }, body: v.body as never })),
    onSuccess: refresh,
  })
}

export type DistributeBody = Body<'/api/v1/console/pricing/token/courses/{course_id}/distribute-tokens', 'post'>

export function useDistributeTokens() {
  const refresh = useInvalidate(['b2c-admin-tcourse', 'b2c-admin-tcourses', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { courseId: string; body: DistributeBody }) =>
      unwrap(api.POST('/api/v1/console/pricing/token/courses/{course_id}/distribute-tokens', { params: { path: { course_id: v.courseId } }, body: v.body })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ cash packages (B2C course bundles)
export type PackageBody = Body<'/api/v1/console/packages', 'post'>
export type PackagePatchBody = Body<'/api/v1/console/packages/{package_id}', 'patch'>

export function useAdminPackages() {
  return useQuery({ queryKey: ['b2c-admin-packages'], queryFn: () => unwrap(api.GET('/api/v1/console/packages')) })
}

export function useCreatePackage() {
  const refresh = useInvalidate(['b2c-admin-packages', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (body: PackageBody) => unwrap(api.POST('/api/v1/console/packages', { body })),
    onSuccess: refresh,
  })
}

export function useUpdatePackage() {
  const refresh = useInvalidate(['b2c-admin-packages', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (v: { packageId: string; body: PackagePatchBody }) =>
      unwrap(api.PATCH('/api/v1/console/packages/{package_id}', { params: { path: { package_id: v.packageId } }, body: v.body })),
    onSuccess: refresh,
  })
}

export function useDeletePackage() {
  const refresh = useInvalidate(['b2c-admin-packages', 'b2c-admin-audit'])
  return useMutation({
    mutationFn: (packageId: string) => unwrap(api.DELETE('/api/v1/console/packages/{package_id}', { params: { path: { package_id: packageId } } })),
    onSuccess: refresh,
  })
}

// ------------------------------------------------------------------ audit
export function useAdminTokenAudit(page = 1) {
  return useQuery({ queryKey: ['b2c-admin-audit', page], queryFn: () => unwrap(api.GET('/api/v1/console/pricing/token/audit', { params: { query: { page } } })) })
}

// ------------------------------------------------------------------ wallet management
export function useAdminStudentSearch(q: string) {
  return useInfiniteQuery({
    queryKey: ['b2c-admin-students', q],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/console/people/students', { params: { query: { q: q || undefined, cursor: pageParam, limit: 20 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: q.trim().length > 0,
  })
}

export function useAdminWallet(userId: string | null) {
  return useQuery({
    queryKey: ['b2c-admin-wallet', userId],
    queryFn: () => unwrap(api.GET('/api/v1/console/wallet/user/{user_id}', { params: { path: { user_id: userId! } } })),
    enabled: !!userId,
  })
}

export function useAdminWalletLedger(userId: string | null) {
  return useQuery({
    queryKey: ['b2c-admin-wallet-ledger', userId],
    queryFn: () => unwrap(api.GET('/api/v1/console/wallet/user/{user_id}/ledger', { params: { path: { user_id: userId! } } })),
    enabled: !!userId,
  })
}

export function useAdjustWallet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; amount: number; note: string }) =>
      unwrap(api.POST('/api/v1/console/wallet/user/{user_id}/adjust', { params: { path: { user_id: v.userId } }, body: { amount: v.amount, note: v.note } })),
    onSuccess: (_d, v) => qc.invalidateQueries({ predicate: (q) => ['b2c-admin-wallet', 'b2c-admin-wallet-ledger'].includes(String(q.queryKey[0])) && q.queryKey[1] === v.userId }),
  })
}
