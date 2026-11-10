type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger'

export const VERSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'info' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  published: { label: 'Live', tone: 'success' },
  retired: { label: 'Retired', tone: 'neutral' },
}
