import { PageHeader } from '@/components/ui/misc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { CompetenciesSection } from './CompetenciesPage'
import { MaturitySection } from './MaturityPage'

/** Merged library page: the KSB competency catalogue and department maturity reviews
 * live together under one "Frameworks library" header, split by two top-level tabs.
 * `tab` sets which one opens first (deep links from the old /maturity route pass
 * "maturity"). */
export function FrameworksLibraryPage({ tab = 'competencies' }: { tab?: 'competencies' | 'maturity' }) {
  return (
    <>
      <PageHeader
        title="Competencies & maturity"
        description="Your skills library (KSBs) and quarterly department maturity reviews, in one place."
      />
      <Tabs defaultValue={tab} className="grid gap-5">
        <TabsList>
          <TabsTrigger value="competencies">Competencies</TabsTrigger>
          <TabsTrigger value="maturity">Department maturity</TabsTrigger>
        </TabsList>
        <TabsContent value="competencies">
          <CompetenciesSection />
        </TabsContent>
        <TabsContent value="maturity">
          <MaturitySection />
        </TabsContent>
      </Tabs>
    </>
  )
}
