import { PageHeader } from '@/components/ui/misc'

import { AnnouncementsTab } from './questions/announcements'

/** Communications: send an announcement to everyone enrolled on one of your courses. */
export function AnnouncementsPage() {
  return (
    <div className="min-w-0">
      <PageHeader title="Communications" description="Send news and announcements to everyone enrolled on a course." />
      <AnnouncementsTab />
    </div>
  )
}
