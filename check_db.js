require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required to run check_db.js.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkDb() {
  console.log('Checking database connection...');
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Database error:', error.message);
    if (error.code === '42P01') {
      console.error('The "students" table does not exist. Please run the SQL schema in your Supabase dashboard.');
    }
  } else {
    console.log('✅ Connection successful. The "students" table exists.');
  }
}

checkDb();
