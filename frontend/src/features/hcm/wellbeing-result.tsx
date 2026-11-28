/** The scored result of a wellbeing check-in, shown to the member after they
 * submit and to HR admins on a member's profile. Pure presentation: give it a
 * `Wellbeing` row and it renders the overall score, the four measures and the
 * written note, like a completed assessment. */
import { Progress } from '@/components/ui/progress'
import { Ring } from '@/components/ui/ring'
import { Badge } from '@/components/ui/badge'
import { shortDate } from '@/lib/format'
import { type Wellbeing, WB_DIMENSIONS, wbBand } from '@/features/hcm/api'

const RING_COLOR: Record<string, string> = {
  success: 'var(--success)',
  primary: 'var(--primary)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
}

const STAY = ['Actively looking elsewhere', 'Might look', 'Not sure', 'Likely to stay', 'Here for the long term']
const SATISFACTION = ['Unhappy', 'Somewhat unhappy', 'Neutral', 'Satisfied', 'Very satisfied']

/** A 0..1 decimal (string from the API) back to its 1..5 answer label. */
function fromUnit(v: string | number | null | undefined, labels: string[]): string | null {
  if (v == null) return null
  const step = Math.min(4, Math.max(0, Math.round(Number(v) * 4)))
  return labels[step]
}

/** The four measure bars. Reused on its own in the history list. */
export function WellbeingBars({ survey }: { survey: Wellbeing }) {
  return (
    <dl className="grid gap-3">
      {WB_DIMENSIONS.map((d) => {
        const score = survey[d.key]
        const band = wbBand(score)
        return (
          <div key={d.key} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-sm font-medium">{d.label}</dt>
              <dd className="text-sm font-semibold tabular">{score}<span className="text-xs font-normal text-muted"> / 100</span></dd>
            </div>
            <Progress value={score} tone={band.tone} label={`${d.label} ${score} out of 100`} />
          </div>
        )
      })}
    </dl>
  )
}

export function WellbeingResult({ survey }: { survey: Wellbeing }) {
  const band = wbBand(survey.overall)
  const stay = fromUnit(survey.stay_intent, STAY)
  const satisfaction = fromUnit(survey.satisfaction, SATISFACTION)

  return (
    <div className="grid gap-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
        <Ring value={survey.overall} label="overall" color={RING_COLOR[band.tone]} />
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-xs tracking-wide text-muted uppercase">Overall wellbeing</p>
          <p className="mt-1">
            <Badge tone={band.tone}>{band.label}</Badge>
          </p>
          <p className="mt-2 text-sm text-muted">
            A blend of your four measures below, from the check-in on {shortDate(survey.submitted_at)}.
          </p>
          {(stay || satisfaction) && (
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              {stay ? <Badge tone="outline">Staying: {stay}</Badge> : null}
              {satisfaction ? <Badge tone="outline">Satisfaction: {satisfaction}</Badge> : null}
            </div>
          )}
        </div>
      </div>

      <WellbeingBars survey={survey} />

      {survey.note ? (
        <figure className="rounded-lg border border-border bg-surface-2/50 p-4">
          <blockquote className="text-sm text-text">“{survey.note}”</blockquote>
          <figcaption className="mt-1.5 text-xs text-muted">In their own words</figcaption>
        </figure>
      ) : null}
    </div>
  )
}
