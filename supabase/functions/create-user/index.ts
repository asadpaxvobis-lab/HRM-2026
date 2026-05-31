// Supabase Edge Function: admin creates user with service role (no email confirm wait)
// Deploy: supabase functions deploy create-user --project-ref zxkkmwycimijvbpgqpfh
// Set secrets: SUPABASE_SERVICE_ROLE_KEY (auto in hosted)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Verify caller JWT and permission
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: canCreate } = await admin.rpc('user_has_permission', { perm_code: 'user.create' })
    // RPC runs as service role - need to check via user's id in public.users
    const { data: profile } = await admin.from('users').select('company_id').eq('id', userData.user.id).single()
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: hasPerm } = await userClient.rpc('user_has_permission', { perm_code: 'user.create' })
    if (!hasPerm) {
      return new Response(JSON.stringify({ error: 'Forbidden: user.create required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { email, password, full_name, phone, role_ids } = body as {
      email: string
      password: string
      full_name?: string
      phone?: string
      role_ids?: string[]
    }

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, force_password_change: false },
    })

    if (createErr || !created.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Create failed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newId = created.user.id

    await admin.from('users').upsert({
      id: newId,
      company_id: profile.company_id,
      email,
      full_name: full_name ?? null,
      phone: phone ?? null,
      status: 'Active',
      force_password_change: false,
      created_by: userData.user.id,
    })

    if (role_ids?.length) {
      await admin.from('user_roles').insert(
        role_ids.map((role_id: string) => ({
          user_id: newId,
          role_id,
          assigned_by: userData.user.id,
        }))
      )
    }

    return new Response(JSON.stringify({ user_id: newId, email }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
