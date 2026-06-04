/**
 * Re-apply baseline seed (0002 + 0003) after REST wipe.
 * Requires DATABASE_URL or SUPABASE_DB_PASSWORD (see run-reseed.ps1).
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const pw = process.env.SUPABASE_DB_PASSWORD
  if (!pw) return null
  return `postgresql://postgres.zxkkmwycimijvbpgqpfh:${encodeURIComponent(pw)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
}

async function main() {
  const url = databaseUrl()
  if (!url) {
    console.error('Set DATABASE_URL or SUPABASE_DB_PASSWORD, then run again.')
    console.error('Or paste supabase/RESET_ALL_DATA.sql in Supabase SQL Editor (skip truncate section if already wiped).')
    process.exit(1)
  }

  const sql = readFileSync(join(root, 'supabase', 'migrations', '0002_seed_permissions_roles.sql'), 'utf8')
    + '\n' + readFileSync(join(root, 'supabase', 'migrations', '0003_seed_admin_user.sql'), 'utf8')

  const sqlConn = postgres(url, { ssl: 'require', max: 1 })
  await sqlConn.unsafe(sql)
  await sqlConn.end({ timeout: 5 })
  console.log('Reseed complete. Login: admin@hrm.com / admin123')
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
