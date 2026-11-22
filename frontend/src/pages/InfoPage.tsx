import { ArrowLeft, Mail } from 'lucide-react'
import { useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Link } from '@/lib/router'

type PageCopy = {
  eyebrow: string
  title: string
  intro: string
  sections: { title: string; body: string }[]
  contact?: boolean
}

const pages: Record<string, PageCopy> = {
  '/about': {
    eyebrow: 'About LearnHub',
    title: 'Learning that proves itself.',
    intro: 'LearnHub brings practical courses, clear progress and recognised evidence into one focused learning experience.',
    sections: [
      { title: 'Built for useful skills', body: 'Our courses are designed around work people actually need to do, with short lessons, practical checks and visible outcomes.' },
      { title: 'For individuals and teams', body: 'Learners can build their own skills while organisations can assign training, track completion and keep compliance evidence together.' },
    ],
  },
  '/careers': {
    eyebrow: 'Careers',
    title: 'Help us make learning more useful.',
    intro: 'We are interested in people who care about clear teaching, thoughtful products and dependable learning experiences.',
    sections: [{ title: 'Work with us', body: 'Current opportunities are shared directly by our team. Send a short introduction and the kind of role you are looking for.' }],
    contact: true,
  },
  '/press': {
    eyebrow: 'Press',
    title: 'LearnHub press enquiries.',
    intro: 'For company information, interviews, brand assets or a comment from the LearnHub team, contact us by email.',
    sections: [{ title: 'Media contact', body: 'Include your publication, deadline and the subject of your enquiry so we can route it quickly.' }],
    contact: true,
  },
  '/help': {
    eyebrow: 'Help centre',
    title: 'How can we help?',
    intro: 'Get help with your account, courses, payments, certificates or organisation training.',
    sections: [
      { title: 'Learner support', body: 'Sign in and open Support from your account to create a ticket and follow replies in one place.' },
      { title: 'Can’t sign in?', body: 'Use the password reset link on the login page. If you still cannot access your account, email our support team.' },
    ],
    contact: true,
  },
  '/contact': {
    eyebrow: 'Contact',
    title: 'Talk to the LearnHub team.',
    intro: 'Tell us what you need and we will direct your message to the right person.',
    sections: [{ title: 'Email', body: 'For course, account, team training, partnership and press enquiries, contact hello@learnhub.com.' }],
    contact: true,
  },
  '/accessibility': {
    eyebrow: 'Accessibility',
    title: 'Learning should work for everyone.',
    intro: 'We aim to make LearnHub clear, keyboard-friendly, responsive and compatible with assistive technology.',
    sections: [
      { title: 'Our approach', body: 'We use semantic controls, visible focus states, text alternatives, readable contrast and reduced-motion support throughout the product.' },
      { title: 'Report a barrier', body: 'If anything stops you from using a course or feature, tell us the page, device and browser involved so we can investigate.' },
    ],
    contact: true,
  },
  '/terms': {
    eyebrow: 'Terms of service',
    title: 'Terms for using LearnHub.',
    intro: 'These terms explain the basic rules that apply when you access LearnHub, create an account or purchase learning content.',
    sections: [
      { title: 'Your account', body: 'Keep your sign-in details secure and provide accurate information. You are responsible for activity carried out through your account.' },
      { title: 'Courses and payments', body: 'Course access, prices, subscription periods and refund eligibility are shown during purchase and in your account.' },
      { title: 'Acceptable use', body: 'Do not misuse the service, interfere with other users, copy protected course content or attempt unauthorised access.' },
    ],
  },
  '/privacy': {
    eyebrow: 'Privacy',
    title: 'How LearnHub handles your information.',
    intro: 'We use account and learning information to provide the service, protect it and show accurate progress and purchase records.',
    sections: [
      { title: 'Information we use', body: 'This may include profile details, course activity, support messages, organisation membership and payment references supplied by our payment provider.' },
      { title: 'Why we use it', body: 'We use this information to operate your account, deliver learning, process purchases, prevent abuse and improve the service.' },
      { title: 'Your choices', body: 'You can update account details in LearnHub and contact us with a privacy or access request.' },
    ],
    contact: true,
  },
  '/cookies': {
    eyebrow: 'Cookies',
    title: 'Cookies used by LearnHub.',
    intro: 'LearnHub uses essential browser storage to keep you signed in, protect forms and remember important preferences.',
    sections: [
      { title: 'Essential cookies', body: 'Session and security cookies are required for sign-in, account protection and purchases.' },
      { title: 'Preferences', body: 'We may remember choices such as theme, currency and interface preferences on your device.' },
    ],
  },
}

export function InfoPage() {
  const { pathname } = useLocation()
  const page = pages[pathname] ?? pages['/about']!

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16 lg:py-20">
      <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted transition-colors hover:text-text">
        <ArrowLeft className="size-4" /> Back to home
      </Link>
      <p className="font-mono text-xs tracking-[0.18em] text-primary uppercase">{page.eyebrow}</p>
      <h1 className="mt-3 max-w-3xl text-3xl leading-tight font-bold tracking-tight text-text sm:text-5xl">{page.title}</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">{page.intro}</p>

      <div className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2">
        {page.sections.map((section) => (
          <Card key={section.title} className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-text">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{section.body}</p>
          </Card>
        ))}
      </div>

      {page.contact ? (
        <Button asChild size="lg" className="mt-8 rounded-full">
          <a href="mailto:hello@learnhub.com"><Mail /> Email LearnHub</a>
        </Button>
      ) : null}
    </main>
  )
}
