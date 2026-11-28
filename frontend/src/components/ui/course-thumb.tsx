import { cn } from '@/lib/cn'

const coverImages: Record<string, string> = {
  development: '/course-covers/default-development.png',
  business: '/course-covers/default-business.png',
  design: '/course-covers/default-design.png',
  'it-software': '/course-covers/default-it-software.png',
  'health-safety': '/course-covers/default-health-safety.png',
  'care-compliance': '/course-covers/default-care-compliance.png',
  marketing: '/course-covers/default-marketing.png',
}

const fallbackImage = '/course-covers/default-general.png'

const coverColorsByCategory: Record<string, { from: string; to: string }> = {
  development: { from: '#a4a9ac', to: '#2a333c' },
  business: { from: '#a4a9ac', to: '#2a333c' },
  design: { from: '#a4a9ac', to: '#2a333c' },
  'it-software': { from: '#a4a9ac', to: '#2a333c' },
  'health-safety': { from: '#a4a9ac', to: '#2a333c' },
  'care-compliance': { from: '#a4a9ac', to: '#2a333c' },
  marketing: { from: '#a4a9ac', to: '#2a333c' },
}
const fallbackColors = { from: '#a4a9ac', to: '#2a333c' }

/** The colour pair used by course-page artwork for a category. */
// eslint-disable-next-line react/only-export-components
export function coverColors(category?: string | null) {
  const { from, to } = coverColorsByCategory[slugOf(category)] ?? fallbackColors
  return { from, to }
}

function slugOf(category?: string | null) {
  return (category ?? '').toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Picks a relevant photographic fallback even when an API response has no category. */
// eslint-disable-next-line react/only-export-components
export function defaultCourseCover(category?: string | null, title?: string | null) {
  const categoryKey = slugOf(category)
  if (coverImages[categoryKey]) return coverImages[categoryKey]

  const subject = `${category ?? ''} ${title ?? ''}`.toLowerCase()
  if (/safeguard|care|mental health|abuse|infection|compliance|gdpr|first aid/.test(subject)) return coverImages['care-compliance']
  if (/health|safety|fire|manual handling|risk|construction|workplace/.test(subject)) return coverImages['health-safety']
  if (/cyber|network|cloud|information technology|\bit\b|software support/.test(subject)) return coverImages['it-software']
  if (/develop|program|coding|code|python|javascript|react|web/.test(subject)) return coverImages.development
  if (/market|sales|social media|advertis|campaign/.test(subject)) return coverImages.marketing
  if (/design|creative|brand|illustrat|ux|ui/.test(subject)) return coverImages.design
  if (/business|management|leader|finance|account|entrepreneur|project/.test(subject)) return coverImages.business

  return fallbackImage
}

export function CourseThumb({ src, title, category, className }: { src?: string | null; title: string; category?: string | null; className?: string }) {
  const fallbackSrc = defaultCourseCover(category, title)

  return (
    <img
      src={src || fallbackSrc}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn('aspect-video w-full rounded-md bg-surface-subtle object-cover', className)}
      onError={(event) => {
        const image = event.currentTarget
        if (image.dataset.fallbackApplied === 'true') return
        image.dataset.fallbackApplied = 'true'
        image.src = fallbackSrc
      }}
    />
  )
}
