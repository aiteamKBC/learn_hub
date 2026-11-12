# LearnHub frontend

React 19 + Vite + TypeScript, Tailwind CSS v4, Radix primitives, TanStack Query, typed API
client generated from the Django OpenAPI schema.

```
npm install
npm run dev          # http://localhost:5173 (proxies /api and /_allauth to Django on :8000)
npm run typecheck && npm run lint && npm run build
npm run gen:api      # refresh src/api/schema.d.ts after backend API changes (Django running)
npm run analyze      # dist/stats.html: what is inside each JS chunk
```

- Design tokens (colours, radius, shadows, light + dark): `src/index.css`. Change the brand there.
- Components: `src/components/ui`; layouts: `src/components/layout`.
- One folder per backend domain under `src/features`; route screens under `src/pages`.
- Every page is lazy-loaded; `/design` renders the whole design system for review.

### Theme-safe native controls

Native inputs inherit the active `color-scheme`, and `src/index.css` explicitly themes
`select` options, browser autofill and scrollbars. Keep form fields on the shared
`Input`, `Textarea` and `NativeSelect` components; do not add page-level white/black
overrides. Intentional paper-like previews (certificates and QR codes) may stay white.

## Page artwork (standing rule)

No page uses a flat background colour. Every page, and every new page in later
milestones, gets custom artwork from `src/components/art/backdrops.tsx`:
generated SVG in the theme colours (follows light/dark), placed behind the top of the
page and faded out so content stays readable. Purely decorative (`aria-hidden`).

| Area | Artwork |
|---|---|
| Home | constellation (network of learning paths) |
| Course catalogue | mosaic (floating course tiles) |
| Course page | waves in the course's category colours |
| My learning | winding path with milestones |
| Business (overview, matrix) | topographic contours |
| Business: people, invitations | org chart (linked nodes) |
| Business: locations & teams | floor plan with map pins |
| Business: reports | chart grid (faint bars, lines, donuts) |
| Business: requirements / library, assign / billing / settings | checklist / mosaic / ribbons / dials |
| Instructor studio, design page | blueprint grid |
| Studio: course curriculum builder | storyboard (film strip with sketched frames) |
| Studio: sales & earnings, payouts | coins (coin stacks beside rising bars) |
| Admin console (dashboard, audit log) | circuit traces |
| Console: approvals | stamp (approval seal over pages) |
| Console: courses / instructors, students / money pages / reports | mosaic / org chart / coins / chart grid |
| Console: reviews, communications / certificates / companies / settings | bubbles / guilloche / contours / dials |
| Sign-in pages | aurora |
| Empty / not found | orbit |
| Player: lesson pages (reading, link, live, quiz, assignment) | notebook (ruled page, pencil marks) |
| Player: video not uploaded yet | aurora on dark |
| Player: tabs under the lesson | orbit |
| Certificates, public verification | guilloche (security-print rosettes) |
| Achievements | honeycomb of badges |
| Required training | checklist on a clipboard |
| Notifications | signal rings from a bell |
| Settings | control dials |
| Help & support | conversation bubbles |
| Course finished (dialog) | confetti |

Pages choose their artwork in the route: `handle: { art: 'guilloche' }` (read by
`LearnerLayout` and `WorkspaceLayout` through `lib/page-art.ts`; the area's default
applies otherwise). Keep shapes to the right half: the left side holds the
sidebar and page titles.

New page: pick the area's variant with `<Backdrop variant="..." />` inside a
`relative isolate` wrapper, or add a new variant to the same file in the same style.

## Motion (standing rule)

Subtle, 150–300 ms, and switched off for people who choose "reduce motion".

- **Page changes**: every `Link`, `NavLink` and `useNavigate` comes from `@/lib/router`,
  which turns on the browser's View Transitions. The page fades out and the next fades in
  rising 8px; header, sidebar and bottom bar stay still (`vt-header`, `vt-sidebar`,
  `vt-bottom-nav`). A course card's cover and title morph into the course page.
- **Loading**: skeletons everywhere; real content cross-fades in (`animate-reveal`).
- **Lists**: wrap cards / rows / sections in `stagger` so they appear 40 ms apart.
- **Numbers and charts**: `CountUp`, `Ring`, `Progress` and the compliance bars count up
  or fill when they scroll into view (`lib/motion.ts`).
- **Micro-interactions**: buttons press in, tab underline slides, menus / dialogs /
  tooltips open and close smoothly, the wishlist heart pops, the cart icon bounces when a
  course is added (`emit('cart:added')`).

New pages follow the same rules: import links from `@/lib/router`, add `stagger` to
lists, `animate-reveal` to content that replaces a skeleton.

## Learning area (M2)

* `/learn/:slug/lecture/:key` is the full-screen player (`pages/learn/`): curriculum
  sidebar (drawer on phones), one stage per lecture kind, tabs for overview, notes,
  Q&A, announcements and review. `/learn/:slug` resumes; `/learn/:slug/qa/:id` and
  `/learn/:slug/announcements/:id` are the notification links.
* Video: Bunny iframe + player.js (loaded on the first video only). Real playing time is
  sent every 30 s and on pause/leave (`keepalive`), and the playhead resumes. A video
  without an upload shows a placeholder that can be completed by hand.
* Quizzes: one question at a time, timer with auto-submit, drafts kept in
  sessionStorage, review after submitting (when the quiz allows it). The view follows
  the attempt's status, never a local flag.
* Assignments: text, https link and files (straight to Azure with a write-only link,
  progress bar, up to 5).
* Certificates (`/learn/certificates`), public `/verify/:code`, achievements,
  required training (per company), notifications (bell polls once a minute), settings
  and support tickets.
* E2E: `tools/e2e_m2.js` (harness) walks a course with every lecture kind end to end.
