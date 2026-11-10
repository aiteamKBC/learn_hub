import { QrCode } from 'lucide-react'

import { cn } from '@/lib/cn'

import type { CertLayout } from './certificates'

export type PreviewData = {
  layout: CertLayout
  signatory_name: string
  signatory_title: string
  signature_preview_url?: string
  show_qr_code: boolean
  platform?: string
}

/**
 * The certificate drawn in the browser from the same layout the PDF renderer reads
 * (style, colours, wording, what is shown), with sample learner details. A4 landscape
 * proportions; it scales with its container so it fits a phone.
 */
export function CertificatePreview({ data, className }: { data: PreviewData; className?: string }) {
  const { layout: l } = data
  const modern = l.style === 'modern'
  const minimal = l.style === 'minimal'
  return (
    <div
      role="img"
      aria-label={`Certificate preview: ${l.heading} for Sara Mahmoud, Advanced React Development`}
      className={cn('@container relative aspect-[297/210] w-full overflow-hidden rounded-md bg-white text-[#111827] shadow-sm ring-1 ring-black/5', className)}
      style={{ ['--p' as string]: l.primary, ['--a' as string]: l.accent }}
    >
      {modern ? (
        <>
          <span aria-hidden className="absolute top-0 left-0 h-[22%] w-[24%] bg-[var(--p)] [clip-path:polygon(0_0,100%_0,0_100%)]" />
          <span aria-hidden className="absolute right-0 bottom-0 h-[22%] w-[24%] bg-[var(--p)] [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
          <span aria-hidden className="absolute inset-[4%] border border-[var(--a)]" />
        </>
      ) : minimal ? (
        <>
          <span aria-hidden className="absolute inset-x-[10%] top-[10%] h-px bg-[var(--p)]" />
          <span aria-hidden className="absolute inset-x-[10%] bottom-[10%] h-px bg-[var(--p)]" />
        </>
      ) : (
        <>
          <span aria-hidden className="absolute inset-[4%] border-[3px] border-[var(--p)]" />
          <span aria-hidden className="absolute inset-[5.5%] border border-[var(--a)]" />
        </>
      )}
      {l.show_seal ? (
        <span aria-hidden className="absolute top-[11%] right-[9%] flex size-[11cqw] items-center justify-center rounded-full bg-[var(--a)]">
          <span className="size-[60%] rounded-full border border-white bg-[var(--p)]" />
        </span>
      ) : null}
      <div className="absolute inset-x-[12%] top-[14%] flex flex-col items-center text-center">
        {l.show_platform ? <p className="text-[2.6cqw] font-bold tracking-[0.2em] text-[var(--p)] uppercase">{data.platform ?? 'LearnHub'}</p> : null}
        <p className={cn('mt-[1.5cqw] text-[5.4cqw] leading-tight font-bold', modern && 'text-[var(--p)]')}>{l.heading}</p>
        <p className="mt-[1.6cqw] text-[2.2cqw] text-[#6B7280]">{l.intro}</p>
        <p className="mt-[1.4cqw] text-[4.6cqw] leading-tight font-bold">Sara Mahmoud</p>
        <p className="mt-[1.4cqw] text-[2.2cqw] text-[#6B7280]">{l.completion}</p>
        <p className="mt-[1cqw] text-[3.4cqw] leading-tight font-bold">Advanced React Development</p>
        <p className="mt-[1.4cqw] text-[1.7cqw] text-[#6B7280]">
          Issued 31 October 2026{l.show_cpd ? ' · 6 CPD hours' : ''}
          {l.show_instructor ? ' · Instructor: Omar Khaled' : ''}
        </p>
      </div>
      {data.signatory_name ? (
        <div className="absolute bottom-[12%] left-[13%] w-[25%]">
          {data.signature_preview_url ? (
            <img src={data.signature_preview_url} alt="" className="mb-[0.5cqw] h-[6cqw] w-auto object-contain" />
          ) : (
            <p className="mb-[0.5cqw] truncate font-serif text-[3cqw] text-[var(--p)] italic">{data.signatory_name}</p>
          )}
          <span className="block h-px bg-[#6B7280]" />
          <p className="mt-[0.8cqw] truncate text-[1.8cqw] font-bold">{data.signatory_name}</p>
          <p className="truncate text-[1.6cqw] text-[#6B7280]">{data.signatory_title}</p>
        </div>
      ) : null}
      {data.show_qr_code ? <QrCode aria-hidden className="absolute right-[9%] bottom-[11%] size-[9cqw] text-[#111827]" strokeWidth={1.25} /> : null}
    </div>
  )
}
