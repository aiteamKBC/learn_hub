import { Megaphone, MessageSquare, Star } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { AnnouncementsTab } from './questions/announcements'
import { QuestionsTab } from './questions/questions'
import { ReviewsTab } from './questions/reviews'

const TABS = ['questions', 'reviews', 'announcements'] as const
type Tab = (typeof TABS)[number]

export function QuestionsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'questions'
  const setTab = (t: string) => setParams(new URLSearchParams(t === 'questions' ? {} : { tab: t }), { replace: true, preventScrollReset: true })

  return (
    <div className="min-w-0">
      <PageHeader title="Q&A and reviews" description="Answer learners' questions, reply to reviews and send news to everyone on a course." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Inbox sections">
          <TabsTrigger value="questions">
            <MessageSquare /> Questions
          </TabsTrigger>
          <TabsTrigger value="reviews">
            <Star /> Reviews
          </TabsTrigger>
          <TabsTrigger value="announcements">
            <Megaphone /> Announcements
          </TabsTrigger>
        </TabsList>
        <TabsContent value="questions">
          <QuestionsTab />
        </TabsContent>
        <TabsContent value="reviews">
          <ReviewsTab />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
