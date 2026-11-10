import { Bell, FileText, Headphones, Megaphone } from 'lucide-react'

import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTabParam } from '@/features/console/ui'

import { AnnouncementsTab, NotificationsTab, TemplatesTab } from './comms/MessagesTabs'
import { TicketsTab } from './comms/TicketsTab'

const TABS = ['tickets', 'notifications', 'announcements', 'templates'] as const

/** Console > Communications (mockup 36): support tickets, notifications and broadcasts,
 * announcements with a site banner, and the wording of every notification. */
export function ConsoleCommunicationsPage() {
  const [tab, setTab] = useTabParam(TABS, 'tickets')
  return (
    <>
      <PageHeader title="Communications & support" description="Answer support tickets, send notifications, publish announcements and edit notification wording." />
      <Tabs value={tab} onValueChange={(t) => setTab(t as (typeof TABS)[number])}>
        <TabsList aria-label="Communications">
          <TabsTrigger value="tickets"><Headphones /> Support tickets</TabsTrigger>
          <TabsTrigger value="notifications"><Bell /> Notifications</TabsTrigger>
          <TabsTrigger value="announcements"><Megaphone /> Announcements</TabsTrigger>
          <TabsTrigger value="templates"><FileText /> Notification templates</TabsTrigger>
        </TabsList>
        <TabsContent value="tickets"><TicketsTab /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab /></TabsContent>
        <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
      </Tabs>
    </>
  )
}
