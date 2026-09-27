// Safe removal script for Commerce students
// Usage:
// SUPABASE_URL=... SUPABASE_ANON_KEY=... node remove_commerce.js
// To actually delete after backup, set FORCE_DELETE=yes

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();
const FORCE_DELETE = String(process.env.FORCE_DELETE || '').toLowerCase() === 'yes';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required to run remove_commerce.js.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  try {
    console.log('Fetching commerce students...');
    const { data: students, error: sErr } = await supabase
      .from('students')
      .select('*')
      .ilike('stream', '%comm%');

    if (sErr) throw sErr;
    if (!students || students.length === 0) {
      console.log('No commerce students found. Nothing to do.');
      return;
    }

    console.log(`Found ${students.length} commerce students.`);

    const rolls = students.map(s => s.roll_no);

    console.log('Fetching matching results...');
    const { data: results, error: rErr } = await supabase
      .from('results')
      .select('*')
      .in('roll_no', rolls);

    if (rErr) throw rErr;

    // Write backups to local files
    const backupDir = path.resolve(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

    const studentsFile = path.join(backupDir, `students_commerce_backup_${Date.now()}.json`);
    const resultsFile = path.join(backupDir, `results_commerce_backup_${Date.now()}.json`);

    fs.writeFileSync(studentsFile, JSON.stringify(students, null, 2));
    fs.writeFileSync(resultsFile, JSON.stringify(results || [], null, 2));

    console.log('Backups written:');
    console.log(' -', studentsFile);
    console.log(' -', resultsFile);

    if (!FORCE_DELETE) {
      console.log('\nTo delete these records, re-run with FORCE_DELETE=yes in your environment.');
      console.log('Example: SUPABASE_URL=... SUPABASE_ANON_KEY=... FORCE_DELETE=yes node remove_commerce.js');
      return;
    }

    console.log('Deleting results for commerce students...');
    const { error: delResErr } = await supabase.from('results').delete().in('roll_no', rolls);
    if (delResErr) throw delResErr;

    console.log('Deleting students...');
    const { error: delStuErr } = await supabase.from('students').delete().in('roll_no', rolls);
    if (delStuErr) throw delStuErr;

    console.log(`Deleted ${rolls.length} commerce students and their results.`);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
})();
