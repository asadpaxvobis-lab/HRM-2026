type CompanyInfo = {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  logo_url?: string | null
}

export function LetterPreviewPaper({
  subject,
  body,
  letterNo,
  dateLabel,
  company,
  signatoryName,
  signatoryTitle,
  compact,
}: {
  subject: string
  body: string
  letterNo?: string
  dateLabel?: string
  company?: CompanyInfo | null
  signatoryName?: string | null
  signatoryTitle?: string | null
  compact?: boolean
}) {
  const pad = compact ? 'p-6' : 'p-12'
  const date =
    dateLabel ??
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div
      className={`bg-white text-black mx-auto w-full max-w-[210mm] shadow-lg border ${pad} ${
        compact ? 'text-[12px]' : 'min-h-[280px]'
      }`}
    >
      <header className={`flex items-start gap-4 border-b pb-4 ${compact ? 'mb-4' : 'mb-8 pb-6'}`}>
        {company?.logo_url ? (
          <img src={company.logo_url} alt={company.name ?? 'Company'} className="h-12 w-12 object-contain" />
        ) : (
          <div className="h-12 w-12 grid place-items-center rounded bg-slate-100 text-slate-400 text-[10px]">
            LOGO
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={`font-bold tracking-tight ${compact ? 'text-base' : 'text-2xl'}`}>
            {company?.name ?? 'Company'}
          </div>
          {company?.address && <div className="text-xs text-slate-600 mt-1">{company.address}</div>}
          <div className="text-xs text-slate-600 mt-0.5 flex gap-3 flex-wrap">
            {company?.phone && <span>Tel: {company.phone}</span>}
            {company?.email && <span>Email: {company.email}</span>}
          </div>
        </div>
        <div className="text-right text-xs text-slate-600 shrink-0">
          {letterNo && <div className="font-mono">{letterNo}</div>}
          <div>Date: {date}</div>
        </div>
      </header>

      <h1
        className={`font-semibold text-center underline underline-offset-4 ${
          compact ? 'text-sm mb-4' : 'text-xl mb-6'
        }`}
      >
        {subject || 'Subject line'}
      </h1>

      <article className={`whitespace-pre-wrap leading-7 ${compact ? 'text-[12px] leading-6' : 'text-[14px]'}`}>
        {body || 'Letter body…'}
      </article>

      {(signatoryName || !compact) && (
        <footer className={compact ? 'mt-6 pt-4' : 'mt-12 pt-6'}>
          {signatoryName ? (
            <div>
              {!compact && <div className="h-12" />}
              <div className="font-semibold">{signatoryName}</div>
              {signatoryTitle && <div className="text-sm text-slate-600">{signatoryTitle}</div>}
              {company?.name && <div className="text-sm text-slate-600">{company.name}</div>}
            </div>
          ) : (
            !compact && (
              <div className="text-xs text-slate-400 italic">
                Signatory block appears when a letter is issued with signatory details.
              </div>
            )
          )}
        </footer>
      )}
    </div>
  )
}
