import { supabase } from '@/lib/supabase'
import { DEFAULT_LETTER_TEMPLATES } from '@/lib/defaultLetterTemplates'

export async function seedDefaultLetterTemplates(companyId: string): Promise<{
  inserted: number
  skipped: number
  error?: string
}> {
  const { data: existing, error: loadErr } = await supabase
    .from('letter_templates')
    .select('code')
    .eq('company_id', companyId)

  if (loadErr) return { inserted: 0, skipped: 0, error: loadErr.message }

  const existingCodes = new Set((existing ?? []).map((r) => r.code as string))
  const toInsert = DEFAULT_LETTER_TEMPLATES.filter((t) => !existingCodes.has(t.code)).map((t) => ({
    company_id: companyId,
    code: t.code,
    name: t.name,
    letter_type: t.letter_type,
    subject: t.subject,
    body: t.body,
    description: t.description,
    is_active: true,
  }))

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: DEFAULT_LETTER_TEMPLATES.length }
  }

  const { error } = await supabase.from('letter_templates').insert(toInsert)
  if (error) return { inserted: 0, skipped: existingCodes.size, error: error.message }

  return {
    inserted: toInsert.length,
    skipped: DEFAULT_LETTER_TEMPLATES.length - toInsert.length,
  }
}
