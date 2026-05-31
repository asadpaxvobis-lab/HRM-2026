import { supabase } from '@/lib/supabase'

type ResetPasswordResponse = { ok?: boolean; error?: string; email?: string }

export async function resetUserPasswordViaAdmin(
  userId: string,
  password: string
): Promise<{ error?: string }> {
  const { data, error } = await supabase.functions.invoke('admin-reset-password', {
    body: { user_id: userId, password },
  })

  if (!error) {
    const payload = (data ?? {}) as ResetPasswordResponse
    if (payload.error) return { error: payload.error }
    if (payload.ok) return {}
    return {}
  }

  const { error: rpcError } = await supabase.rpc('admin_reset_user_password', {
    p_user_id: userId,
    p_password: password,
  })

  if (!rpcError) return {}

  const fnMessage = error.message
  const rpcMessage = rpcError.message
  if (fnMessage && fnMessage !== rpcMessage) {
    return { error: `${fnMessage} (fallback: ${rpcMessage})` }
  }
  return { error: rpcMessage || fnMessage || 'Password reset failed' }
}
