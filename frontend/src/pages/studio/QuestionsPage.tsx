import { PageHeader } from '@/components/ui/misc'

import { QuestionsTab } from './questions/questions'

/** Q&A: the inbox of learner questions across the instructor's courses. */
export function QuestionsPage() {
  return (
    <div className="min-w-0">
      <PageHeader title="Q&A" description="Answer the questions learners ask on your courses." />
      <QuestionsTab />
    </div>
  )
}
