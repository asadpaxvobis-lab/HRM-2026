import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zxkkmwycimijvbpgqpfh.supabase.co'
const supabaseAnonKey = 'sb_publishable_m6JgkY2WR6VZ2-ZOo29-Ow_Ehw4M27D'

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  const { data: devices, error } = await supabase
    .from('attendance_devices')
    .select('id, name, device_type, serial_no')
  if (error) {
    console.error('Error fetching devices:', error)
  } else {
    console.log('Devices:', JSON.stringify(devices, null, 2))
  }
}

run()
