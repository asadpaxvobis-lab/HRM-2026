/**
 * Wipe all public rows + auth users on remote Supabase via service role REST API.
 * Re-seed requires RESET_ALL_DATA.sql in SQL Editor (permissions catalog is too large for REST).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadConfig() {
  const localPath = join(root, 'apps', 'agent', 'appsettings.Local.json')
  try {
    const j = JSON.parse(readFileSync(localPath, 'utf8'))
    if (j?.Supabase?.Url && j?.Supabase?.ServiceRoleKey) {
      return { url: j.Supabase.Url, key: j.Supabase.ServiceRoleKey }
    }
  } catch {
    /* ignore */
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) return { url, key }
  throw new Error('Set apps/agent/appsettings.Local.json or SUPABASE_SERVICE_ROLE_KEY')
}

/** Child tables first */
const TABLES = [
  'zkt_fetch_log_entries',
  'zkt_device_fetch_runs',
  'zkt_agent_heartbeat',
  'employee_device_pins',
  'attendance_punches',
  'attendance_daily',
  'attendance_corrections',
  'payslip_lines',
  'payslips',
  'payroll_runs',
  'payroll_periods',
  'loan_installments',
  'loans',
  'expense_claim_lines',
  'expense_claims',
  'overtime_requests',
  'leave_applications',
  'leave_balances',
  'announcement_reads',
  'announcements',
  'letters',
  'resignation_clearance_steps',
  'resignations',
  'recruitment_interviews',
  'candidates',
  'job_postings',
  'employee_documents',
  'employee_salary_history',
  'employee_shift_assignments',
  'employee_statutory_enrollment',
  'branch_holiday_exclusions',
  'attendance_devices',
  'audit_logs',
  'login_attempts',
  'user_invitations',
  'user_permission_overrides',
  'user_2fa',
  'user_roles',
  'users',
  'employees',
  'employee_documents',
  'departments',
  'designations',
  'branches',
  'role_permissions',
  'roles',
  'permissions',
  'allowed_ip_ranges',
  'loan_types',
  'expense_categories',
  'payroll_components',
  'tax_slabs',
  'leave_types',
  'holidays',
  'shifts',
  'letter_templates',
  'app_settings',
  'companies',
]

async function deleteAllFrom(supabase, table) {
  const sentinel = '00000000-0000-0000-0000-000000000000'
  const { error } = await supabase.from(table).delete().neq('id', sentinel)
  if (error && !error.message.includes('does not exist')) {
    const { error: e2 } = await supabase.from(table).delete().gte('created_at', '1970-01-01')
    if (e2 && !e2.message.includes('does not exist') && !e2.message.includes('column')) {
      console.warn(`  skip ${table}: ${e2.message}`)
      return
    }
  }
}

async function clearAuth(supabase) {
  let page = 1
  const perPage = 200
  let total = 0
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const users = data?.users ?? []
    if (users.length === 0) break
    for (const u of users) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(u.id)
      if (delErr) console.warn(`  auth delete ${u.email}: ${delErr.message}`)
      else total++
    }
    if (users.length < perPage) break
    page++
  }
  console.log(`Deleted ${total} auth user(s).`)
}

async function clearStorage(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) {
    console.warn(`Storage list: ${error.message}`)
    return
  }
  for (const bucket of buckets ?? []) {
    const { data: top } = await supabase.storage.from(bucket.name).list('', { limit: 1000 })
    if (!top?.length) continue
    const paths = top.map((o) => o.name)
    const { error: remErr } = await supabase.storage.from(bucket.name).remove(paths)
    if (remErr) console.warn(`  bucket ${bucket.name}: ${remErr.message}`)
    else console.log(`  cleared ${paths.length} object(s) in ${bucket.name}`)
  }
}

async function main() {
  const { url, key } = loadConfig()
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('Clearing storage buckets...')
  await clearStorage(supabase)

  console.log('Deleting public table rows...')
  for (const table of TABLES) {
    process.stdout.write(`  ${table}... `)
    await deleteAllFrom(supabase, table)
    console.log('ok')
  }

  console.log('Clearing auth users...')
  await clearAuth(supabase)

  console.log('')
  console.log('REST wipe done. Run SQL reseed (required for permissions + admin):')
  console.log('  npm run reset:db')
  console.log('  Or paste supabase/RESET_ALL_DATA.sql in Supabase SQL Editor.')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
