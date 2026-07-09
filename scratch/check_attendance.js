const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://zxkkmwycimijvbpgqpfh.supabase.co';
const supabaseAnonKey = 'sb_publishable_m6JgkY2WR6VZ2-ZOo29-Ow_Ehw4M27D';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  // Log in
  let { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'admin@hrm.com',
    password: 'admin123'
  });
  if (authErr) {
    console.error('Auth error:', authErr.message);
    return;
  }

  const employeeId = '15e12526-7261-4321-9ece-b1f8bba3f858';
  const dateStr = '2026-07-04';

  console.log(`Querying attendance_daily for employee ${employeeId} on ${dateStr}...`);
  const { data: daily, error: dailyErr } = await supabase
    .from('attendance_daily')
    .select('employee_id, attendance_date, status, first_in, last_out, worked_minutes, late_minutes, overtime_minutes')
    .eq('employee_id', employeeId)
    .eq('attendance_date', dateStr)
    .maybeSingle();

  if (dailyErr) {
    console.error('Error fetching daily:', dailyErr);
  } else {
    console.log('Daily record:', daily);
  }

  console.log('\nQuerying attendance_punches for employee...');
  const { data: punches, error: punchErr } = await supabase
    .from('attendance_punches')
    .select('employee_id, punch_at, punch_type, source')
    .eq('employee_id', employeeId)
    .order('punch_at', { ascending: true });

  if (punchErr) {
    console.error('Error fetching punches:', punchErr);
  } else {
    console.log('Punches:');
    console.table(punches);
  }
}

check();
