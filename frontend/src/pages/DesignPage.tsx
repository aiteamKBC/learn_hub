import { AlertOctagon, Award, BookOpen, Download, Heart, MoreHorizontal, Plus, Search, Settings, Trash2, TrendingUp, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { Backdrop } from '@/components/art/backdrops'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { EmptyState, PageHeader, Rating, StatCard } from '@/components/ui/misc'
import { Progress } from '@/components/ui/progress'
import { Ring } from '@/components/ui/ring'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox, Switch } from '@/components/ui/switch'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CourseCard, CourseCardSkeleton } from '@/features/catalog/CourseCard'
import type { CourseCardData } from '@/features/catalog/api'

const sample = (o: Partial<CourseCardData>): CourseCardData => ({
  id: o.title ?? 'x', slug: 'fire-safety-awareness', title: 'Fire Safety Awareness', subtitle: '', thumbnail_url: '', level: 'all', category: 'Health & Safety',
  rating_avg: 4.7, rating_count: 1284, student_count: 71, lecture_count: 7, total_duration_sec: 3007, instructors: ['LearnHub Academy'],
  price: { currency: 'GBP', exponent: 2, free: false, list_minor: 2499, sale_minor: null }, ...o,
}) as CourseCardData

const swatches = [
  ['Primary', 'bg-primary'], ['Primary soft', 'bg-primary-soft'], ['Navy (sidebar)', 'bg-nav'], ['Background', 'bg-background'], ['Surface', 'bg-surface'], ['Surface 2', 'bg-surface-2'],
  ['Success', 'bg-success'], ['Warning', 'bg-warning'], ['Danger', 'bg-danger'], ['Info', 'bg-info'], ['Text', 'bg-text'], ['Muted', 'bg-muted'],
]

function Block({ title, children, note }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-10 first:border-0 first:pt-0 lg:grid-cols-[220px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note ? <p className="mt-1 text-sm text-muted">{note}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** The design system, rendered: every token and component in both themes (use the
 * theme switch at the top). This is the sign-off page for M0. */
export function DesignPage() {
  return (
    <div className="relative isolate">
      <Backdrop variant="blueprint" height={460} />
    <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title="LearnHub design system" description="Colours, type and components used on every screen. Switch light / dark with the sun icon above." />

      <Block title="Colour" note="Defined once as tokens; dark mode swaps the values, not the screens.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {swatches.map(([name, cls]) => (
            <div key={name}>
              <div className={`h-16 rounded-lg border border-border ${cls}`} />
              <p className="mt-1.5 text-xs font-medium">{name}</p>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Typography" note="Inter, self-hosted. Numbers use tabular figures so columns line up.">
        <div className="grid gap-3">
          <p className="text-[40px] leading-tight font-bold tracking-tight">Learn. Improve. Advance.</p>
          <p className="text-2xl font-semibold tracking-tight">Page title · 26 / semibold</p>
          <p className="text-[15px] font-semibold">Card title · 15 / semibold</p>
          <p className="text-[15px]">Body · 15 / regular. Clear, friendly copy that says what happens next.</p>
          <p className="text-sm text-muted">Secondary · 14 / muted</p>
          <p className="text-xs text-subtle">Caption · 12 / subtle</p>
          <p className="text-2xl font-semibold tabular">£1,260.00 · 66.9% · 1,284</p>
        </div>
      </Block>

      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus /> Primary
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">
            <Trash2 /> Delete
          </Button>
          <Button variant="link">Link</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="secondary" aria-label="Settings">
            <Settings />
          </Button>
        </div>
      </Block>

      <Block title="Forms" note="Labels, hints and errors are connected for screen readers.">
        <div className="grid max-w-xl gap-4">
          <Field label="Course title" hint="Shown on the course card and certificate.">
            {(p) => <Input {...p} placeholder="e.g. Fire Safety Awareness" />}
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            {(p) => <Input {...p} defaultValue="hana@brightwater" />}
          </Field>
          <Input icon={<Search />} placeholder="Search with an icon" aria-label="Search" />
          <NativeSelect aria-label="Level" defaultValue="beginner">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
          </NativeSelect>
          <Textarea placeholder="Description" aria-label="Description" />
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox defaultChecked /> Required for everyone
            </label>
            <label className="flex items-center gap-2">
              <Switch defaultChecked /> Send reminders
            </label>
          </div>
        </div>
      </Block>

      <Block title="Badges and status">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success" dot>Compliant</Badge>
          <Badge tone="warning" dot>Expiring soon</Badge>
          <Badge tone="info" dot>In progress</Badge>
          <Badge tone="danger" dot>Overdue</Badge>
          <Badge tone="primary">Preview</Badge>
          <Badge>Draft</Badge>
          <Badge tone="outline">Beginner</Badge>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-6">
          <Rating value={4.7} count={1284} size="md" />
          <div className="flex -space-x-2">
            {['Hana Cole', 'Ryan Ali', 'Grace Hall', 'Ben Malik'].map((n) => (
              <Avatar key={n} name={n} className="ring-2 ring-surface" />
            ))}
          </div>
          <div className="w-48">
            <Progress value={68} label="Progress" />
          </div>
          <Ring value={67} size={96} stroke={9} label="compliant" />
        </div>
      </Block>

      <Block title="Stat cards">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total sales" value="£1,260" icon={<TrendingUp />} trend={{ value: '24%', up: true }} hint="vs previous 30 days" />
          <StatCard label="Learners" value="12,840" icon={<Users />} tone="info" trend={{ value: '8%', up: true }} hint="this month" />
          <StatCard label="Certificates" value="486" icon={<Award />} tone="success" />
          <StatCard label="Overdue" value="27" icon={<AlertOctagon />} tone="danger" trend={{ value: '3', up: true, good: false }} hint="since last week" />
        </div>
      </Block>

      <Block title="Course cards" note="Courses without an image get a branded cover by category.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <CourseCard course={sample({ title: 'Fire Safety Awareness' })} />
          <CourseCard course={sample({ title: 'Python for Data Analysis', category: 'Development', instructors: ['Daniel Reeve'], level: 'beginner', rating_avg: 4.8, price: { currency: 'GBP', exponent: 2, free: false, list_minor: 4999, sale_minor: 1499 } })} />
          <CourseCard course={sample({ title: 'Brand Design Basics', category: 'Design', instructors: ['Amira Haddad'], student_count: 12, price: { currency: 'GBP', exponent: 2, free: true, list_minor: 0, sale_minor: null } })} />
          <CourseCardSkeleton />
        </div>
      </Block>

      <Block title="Cards, tabs and tables">
        <Card>
          <CardHeader title="Recent transactions" description="Your last five sales" action={<Button variant="secondary" size="sm"><Download /> Export</Button>} />
          <Tabs defaultValue="all" className="mt-3 px-5">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="courses">Courses</TabsTrigger>
              <TabsTrigger value="subs">Subscriptions</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="-mx-5 pt-0">
              <Table>
                <thead>
                  <tr>
                    <Th>Learner</Th>
                    <Th>Course</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Amount</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Sara Ahmed', 'Web Development Fundamentals', 'Paid', '£20.00'],
                    ['Omar Khaled', 'HTML & CSS Essentials', 'Paid', '£15.00'],
                    ['Mona Hassan', 'JavaScript Basics', 'Refunded', '£20.00'],
                  ].map(([n, c, s, a]) => (
                    <Tr key={n}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={n} size="sm" /> <span className="font-medium">{n}</span>
                        </div>
                      </Td>
                      <Td className="text-muted">{c}</Td>
                      <Td>
                        <Badge tone={s === 'Paid' ? 'success' : 'danger'} dot>
                          {s}
                        </Badge>
                      </Td>
                      <Td className="text-right font-medium tabular">{a}</Td>
                      <Td className="w-10 text-right">
                        <Menu>
                          <MenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                              <MoreHorizontal />
                            </Button>
                          </MenuTrigger>
                          <MenuContent>
                            <MenuItem>
                              <BookOpen /> View order
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem className="text-danger">
                              <Trash2 /> Refund
                            </MenuItem>
                          </MenuContent>
                        </Menu>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TabsContent>
            <TabsContent value="courses">
              <EmptyState icon={<BookOpen />} title="Nothing here yet" body="Sales of single courses will show here." />
            </TabsContent>
            <TabsContent value="subs">
              <EmptyState icon={<Heart />} title="No subscriptions" />
            </TabsContent>
          </Tabs>
        </Card>
      </Block>

      <Block title="Feedback" note="Dialogs, toasts and loading states.">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent title="Remove Grace Hall?" description="She keeps her certificates; her company training stops.">
              <div className="flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="danger" onClick={() => toast.success('Grace Hall was removed')}>
                    Remove
                  </Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={() => toast.success('Reminder sent to Ryan Ali')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Payments are not available in this currency.')}>
            Error toast
          </Button>
        </div>
        <Card className="mt-5">
          <CardBody className="grid gap-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardBody>
        </Card>
      </Block>
    </div>
    </div>
  )
}
