import { PageHeader } from '@/components/ui/misc'

import { ReviewsTab } from './questions/reviews'

/** Reviews & feedback: learner reviews across the instructor's courses, with replies. */
export function ReviewsPage() {
  return (
    <div className="min-w-0">
      <PageHeader title="Reviews & feedback" description="Read what learners say about your courses and reply to them." />
      <ReviewsTab />
    </div>
  )
}
