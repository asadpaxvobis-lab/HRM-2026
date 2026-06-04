/**
 * Re-seed company, permissions, roles, and admin user via Supabase REST (no DB password).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const COMPANY = '00000000-0000-0000-0000-000000000001'
const ADMIN_ID = '00000000-0000-0000-0000-00000000ffff'
const SUPER_ADMIN = '00000000-0000-0000-0000-00000000aaa1'

function loadConfig() {
  const localPath = join(root, 'apps', 'agent', 'appsettings.Local.json')
  const j = JSON.parse(readFileSync(localPath, 'utf8'))
  return { url: j.Supabase.Url, key: j.Supabase.ServiceRoleKey }
}

function parsePermissions(sql) {
  const re = /\('([^']+)',\s*'([^']+)',\s*'([^']*)',\s*true\)/g
  const rows = []
  let m
  while ((m = re.exec(sql)) !== null) {
    rows.push({ module: m[1], action: m[2], description: m[3], is_system: true })
  }
  return rows
}

async function main() {
  const { url, key } = loadConfig()
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const sql2 = readFileSync(join(root, 'supabase', 'migrations', '0002_seed_permissions_roles.sql'), 'utf8')

  await supabase.from('companies').upsert({
    id: COMPANY,
    name: 'My Company',
    legal_name: 'My Company (Pvt) Ltd',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    fiscal_year_start_month: 7,
  })
  await supabase.from('app_settings').upsert({ company_id: COMPANY })

  const perms = parsePermissions(sql2)
  console.log(`Inserting ${perms.length} permissions...`)
  for (let i = 0; i < perms.length; i += 50) {
    const chunk = perms.slice(i, i + 50)
    const { error } = await supabase.from('permissions').upsert(chunk, {
      onConflict: 'code',
      ignoreDuplicates: true,
    })
    if (error) throw error
  }

  const roles = [
    { id: SUPER_ADMIN, company_id: COMPANY, name: 'Super Admin', description: 'Full access', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa2', company_id: COMPANY, name: 'HR Admin', description: 'Full HR + Payroll', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa3', company_id: COMPANY, name: 'HR Officer', description: 'HR operations', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa4', company_id: COMPANY, name: 'Payroll Officer', description: 'Payroll operations', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa5', company_id: COMPANY, name: 'Department Manager', description: 'Department scope', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa6', company_id: COMPANY, name: 'Branch Manager', description: 'Branch scope', is_built_in: true },
    { id: '00000000-0000-0000-0000-00000000aaa7', company_id: COMPANY, name: 'Employee', description: 'Self-service', is_built_in: true },
  ]
  await supabase.from('roles').upsert(roles)

  const { data: allPerms } = await supabase.from('permissions').select('id, code')
  const byCode = Object.fromEntries((allPerms ?? []).map((p) => [p.code, p.id]))

  const superLinks = (allPerms ?? []).map((p) => ({ role_id: SUPER_ADMIN, permission_id: p.id }))
  for (let i = 0; i < superLinks.length; i += 100) {
    await supabase.from('role_permissions').upsert(superLinks.slice(i, i + 100), {
      onConflict: 'role_id,permission_id',
      ignoreDuplicates: true,
    })
  }

  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 200 })
  const found = existing?.users?.find((u) => u.email === 'admin@hrm.com')
  if (found) await supabase.auth.admin.deleteUser(found.id)

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    id: ADMIN_ID,
    email: 'admin@hrm.com',
    password: 'admin123',
    email_confirm: true,
    user_metadata: { full_name: 'System Administrator', force_password_change: true },
  })
  if (createErr) throw createErr

  const uid = created.user?.id ?? ADMIN_ID
  await supabase.from('users').upsert({
    id: uid,
    company_id: COMPANY,
    email: 'admin@hrm.com',
    full_name: 'System Administrator',
    status: 'Active',
    force_password_change: true,
  })
  await supabase.from('user_roles').upsert({ user_id: uid, role_id: SUPER_ADMIN })

  console.log('Reseed complete. Login: admin@hrm.com / admin123')
  console.log(`Permissions: ${Object.keys(byCode).length}, Super Admin role linked.`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
