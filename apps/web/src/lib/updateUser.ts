import { supabase } from '@/lib/supabase'

export async function updateUserViaAdmin(params: {
  user_id: string
  full_name?: string | null
  phone?: string | null
  status?: 'Active' | 'Disabled' | 'Pending'
  role_ids?: string[]
}): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('admin_update_user', {
    p_user_id: params.user_id,
    p_full_name: params.full_name ?? null,
    p_phone: params.phone ?? null,
    p_status: params.status ?? null,
    p_role_ids: params.role_ids ?? null,
  })
  if (error) return { error: error.message }
  return {}
}
