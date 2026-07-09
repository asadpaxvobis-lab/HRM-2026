import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zxkkmwycimijvbpgqpfh.supabase.co'
const supabaseAnonKey = 'sb_publishable_m6JgkY2WR6VZ2-ZOo29-Ow_Ehw4M27D'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  // Log in as the admin user
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@hrm.com',
    password: 'admin123'
  })

  if (authError) {
    console.error('Authentication failed:', authError)
    return
  }

  console.log('Logged in successfully!')

  // Query devices
  const { data: devices, error: devError } = await supabase
    .from('attendance_devices')
    .select('id, name, device_type, serial_no')
  
  if (devError) {
    console.error('Error fetching devices:', devError)
  } else {
    console.log('Devices:', JSON.stringify(devices, null, 2))
  }
}

run()
