require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  console.error('Copy .env.example to .env and configure your Supabase credentials before starting the server.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();

if (!ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('ERROR: ADMIN_PASSWORD and JWT_SECRET are required.');
  process.exit(1);
}

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

app.use(express.json());

// Serve dynamic JS for Vite/Supabase runtime env
app.get('/js/supabase-env.js', (req, res) => {
  const url = String(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim() || null;
  const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim() || null;
  res.type('application/javascript').send(`window.__supabaseClientConfig = { url: ${JSON.stringify(url)}, anonKey: ${JSON.stringify(anonKey)} };`);
});

app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });

// Admin Middleware
function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── ADMIN ENDPOINTS ──────────────────────────────────────

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect password' });

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, message: 'Admin login successful' });
});

// POST /api/upload-excel
app.post('/api/upload-excel', verifyAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for result uploads' });
    }

    const batchLabels = {
      '1st_puc_science': '1st PUC',
      '2nd_puc_science': '2nd PUC'
    };
    const selectedBatch = String(req.body.batch || '').trim();
    const classGrade = batchLabels[selectedBatch];
    if (!classGrade) return res.status(400).json({ error: 'Please select a valid PUC batch' });
    const examType = String(req.body.exam_type || 'monthly').trim().toLowerCase();
    if (!['monthly', 'yearly'].includes(examType)) {
      return res.status(400).json({ error: 'Please select a valid exam type' });
    }

    const totalMaxMarks = examType === 'yearly' ? 450 : 225;
    const subjectMaxMarks = examType === 'yearly'
      ? { English: 80, Kannada: 80, Mathematics: 80, Physics: 70, Chemistry: 70, 'Computer Science': 70, Biology: 70 }
      : { English: 40, Kannada: 40, Mathematics: 40, Physics: 35, Chemistry: 35, 'Computer Science': 35, Biology: 35 };

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return res.status(400).json({ error: 'Excel file is empty' });

    const nonSubjectKeys = new Set([
      'rollno', 'rollnumber', 'name', 'studentname', 'class', 'classgrade', 'stream', 'combination', 'totalmarks',
      'maxmarks', 'totalmaxmarks', 'examtype', 'percentage', 'collegerank', 'streamrank'
    ]);

    const subjectKeyMap = {
      physics: 'Physics', chemistry: 'Chemistry', math: 'Mathematics', maths: 'Mathematics', mathematics: 'Mathematics',
      biology: 'Biology', computer: 'Computer Science', computerscience: 'Computer Science',
      english: 'English', kannada: 'Kannada'
    };

    function normalizeKey(key) {
      return String(key || '').trim().toLowerCase().replace(/[\s_.-]/g, '');
    }

    function getRowValue(row, aliases) {
      const candidates = aliases.map((alias) => normalizeKey(alias));
      for (const [key, value] of Object.entries(row)) {
        if (candidates.includes(normalizeKey(key))) {
          return value;
        }
      }
      return '';
    }

    function titleCase(key) {
      return String(key || '')
        .replace(/[_\-]/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase())
        .trim();
    }

    let parsedRows = rows.map((row) => {
      const rollNo = String(getRowValue(row, ['Roll No', 'RollNo', 'roll_no', 'rollno', 'roll number']) || '').trim().toUpperCase();
      const name = String(getRowValue(row, ['Name', 'name', 'Student Name', 'studentname']) || '').trim();
      const stream = 'Science';

      const combination = String(getRowValue(row, ['Combination', 'combination', 'comb']) || '').trim();

      if (!rollNo || !name) return null;

      const normalizedCombination = combination.toUpperCase().replace(/[^A-Z]/g, '');
      const activeSubjects = normalizedCombination.includes('PCMB') || normalizedCombination.includes('BIOLOGY')
        ? ['Kannada', 'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology']
        : normalizedCombination.includes('PCMC') || normalizedCombination.includes('COMPUTER')
          ? ['Kannada', 'English', 'Mathematics', 'Physics', 'Chemistry', 'Computer Science']
          : null;
      if (!activeSubjects) return { error: `Combination must identify PCMC or PCMB (received: ${combination || 'empty'})` };

      const marks = {};
      let invalidMark = null;
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (nonSubjectKeys.has(normalizedKey)) return;
        if (value === undefined || value === null || value === '') return;

        const mark = parseInt(value, 10);
        if (Number.isNaN(mark)) return;

        const displayName = subjectKeyMap[normalizedKey] || titleCase(key);
        if (!activeSubjects.includes(displayName)) return;
        marks[displayName] = mark;
        if (subjectMaxMarks[displayName] !== undefined && (mark < 0 || mark > subjectMaxMarks[displayName])) {
          invalidMark = `${displayName} must be between 0 and ${subjectMaxMarks[displayName]} for a ${examType} exam`;
        }
      });

      if (invalidMark) return { error: invalidMark };
      if (Object.keys(marks).length === 0) return null;

      const totalMarks = activeSubjects.reduce((sum, subject) => sum + (marks[subject] ?? 0), 0);
      const percentage = parseFloat(((totalMarks / totalMaxMarks) * 100).toFixed(2));

      return {
        rollNo,
        name,
        classGrade,
        stream,
        combination,
        marks,
        totalMarks,
        totalMaxMarks,
        examType,
        percentage
      };
    }).filter(Boolean);

    const invalidRow = parsedRows.find((item) => item.error);
    if (invalidRow) return res.status(400).json({ error: invalidRow.error });
    parsedRows = parsedRows.filter((item) => item.stream === 'Science');

    if (parsedRows.length === 0) {
      return res.status(400).json({
        error: 'No valid students found. Use the required headers: Roll No, Name, Combination, Physics, Chemistry, Mathematics, Computer Science, English, Kannada.'
      });
    }

    function parseYearFromClass(classGrade) {
      const s = String(classGrade || '').toLowerCase();
      if (/\b1\b|\b1st\b|first|year\s*1/.test(s)) return 1;
      if (/\b2\b|\b2nd\b|second|year\s*2/.test(s)) return 2;
      const m = s.match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
      return null;
    }

    const groupsByYear = {};
    parsedRows.forEach((item) => {
      item.year = parseYearFromClass(item.classGrade) || 'unknown';
      const key = String(item.year);
      if (!groupsByYear[key]) groupsByYear[key] = [];
      groupsByYear[key].push(item);
    });

    Object.values(groupsByYear).forEach((group) => {
      group.sort((a, b) => b.totalMarks - a.totalMarks);
      group.forEach((it, i) => { it.yearRank = i + 1; });
    });

    let successCount = 0;
    let hasResultsYearRankColumn = false;

    try {
      const { error: yearRankError } = await supabaseAdmin.from('results').select('year_rank').limit(1);
      if (!yearRankError) hasResultsYearRankColumn = true;
    } catch (e) {
      hasResultsYearRankColumn = false;
    }

    for (const item of parsedRows) {
      const { error: studentUpsertError } = await supabaseAdmin.from('students').upsert({
        roll_no: item.rollNo,
        name: item.name,
        password: item.rollNo,
        class_grade: classGrade,
        stream: item.stream,
        combination: item.combination
      }, { onConflict: 'roll_no' });
      if (studentUpsertError) return res.status(500).json({ error: studentUpsertError.message });

      const resultPayload = {
        roll_no: item.rollNo,
        physics: item.marks.Physics ?? null,
        chemistry: item.marks.Chemistry ?? null,
        mathematics: item.marks.Mathematics ?? null,
        biology: item.marks.Biology ?? null,
        computer_science: item.marks['Computer Science'] ?? null,
        english: item.marks.English ?? null,
        kannada: item.marks.Kannada ?? null,
        total_marks: item.totalMarks,
        total_max_marks: item.totalMaxMarks,
        exam_type: item.examType,
        percentage: item.percentage
      };

      if (hasResultsYearRankColumn) {
        resultPayload.year_rank = item.yearRank;
      }

      const { error: resultUpsertError } = await supabaseAdmin.from('results').upsert(resultPayload, { onConflict: 'roll_no' });
      if (resultUpsertError) return res.status(500).json({ error: resultUpsertError.message });

      successCount++;
    }

    res.json({
      success: true,
      message: `Uploaded and ranked ${successCount} Science students!`,
      successCount
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process upload' });
  }
});

// List Students
app.get('/api/admin/students', verifyAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('students')
    .select('roll_no, name, class_grade, stream, combination')
    .eq('stream', 'Science')
    .order('roll_no', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, students: data });
});

// Delete all Science students and their results so a replacement sheet can be uploaded
app.delete('/api/admin/data', verifyAdmin, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is required for admin deletion' });
    }

    const { data: students, error: studentsError } = await supabaseAdmin
      .from('students')
      .select('roll_no')
      .eq('stream', 'Science');

    if (studentsError) return res.status(500).json({ error: studentsError.message });

    const rollNumbers = (students || []).map((student) => student.roll_no).filter(Boolean);
    if (rollNumbers.length === 0) {
      return res.json({ success: true, deletedStudents: 0, deletedResults: 0, message: 'No Science data to delete' });
    }

    const { error: resultsError } = await supabaseAdmin
      .from('results')
      .delete()
      .in('roll_no', rollNumbers);

    if (resultsError) return res.status(500).json({ error: resultsError.message });

    const { error: deleteStudentsError } = await supabaseAdmin
      .from('students')
      .delete()
      .eq('stream', 'Science');

    if (deleteStudentsError) return res.status(500).json({ error: deleteStudentsError.message });

    res.json({
      success: true,
      deletedStudents: rollNumbers.length,
      deletedResults: rollNumbers.length,
      message: `Deleted ${rollNumbers.length} Science students and their results`
    });
  } catch (err) {
    console.error('Delete data error:', err);
    res.status(500).json({ error: 'Failed to delete existing data' });
  }
});

// Add Single Student
app.post('/api/admin/student', verifyAdmin, async (req, res) => {
  const { roll_no, name, password, class_grade, stream, combination } = req.body;
  if (!roll_no || !name) return res.status(400).json({ error: 'Roll number and name required' });

  if (String(stream || '').trim().toLowerCase() !== 'science') {
    return res.status(400).json({ error: 'Only Science students are supported' });
  }

  const { error } = await supabase.from('students').upsert({
    roll_no, name, password: password || roll_no, class_grade, stream, combination
  }, { onConflict: 'roll_no' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: `Student ${roll_no} added` });
});

// ── STUDENT ENDPOINTS ────────────────────────────────────

// Student Login
app.post('/api/student/login', async (req, res) => {
  try {
    const { roll_no, password } = req.body;
    if (!roll_no || !password) return res.status(400).json({ error: 'Roll number and password required' });

    const normalizedRollNo = String(roll_no || '').trim().toUpperCase();

    const { data, error } = await supabase
      .from('students')
      .select('roll_no, name, password, stream')
      .eq('stream', 'Science')
      .ilike('roll_no', normalizedRollNo)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Student not found' });
    if (data.password !== password) return res.status(401).json({ error: 'Incorrect password' });

    res.json({ success: true, student: { roll_no: data.roll_no, name: data.name } });
  } catch (err) {
    console.error('[POST /api/student/login] failed', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get Student Result
app.get('/api/student/result/:roll_no', async (req, res) => {
  try {
    const roll_no = String(req.params.roll_no || '').trim();
    const normalizedRollNo = roll_no.toUpperCase();

    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('roll_no, name, class_grade, stream, combination')
      .eq('stream', 'Science')
      .ilike('roll_no', normalizedRollNo)
      .single();

    if (studentError || !student) return res.status(404).json({ error: 'Student not found' });

    const { data: result, error: resultError } = await supabase
      .from('results')
      .select('*')
      .ilike('roll_no', normalizedRollNo)
      .single();

    if (resultError || !result) return res.status(404).json({ error: 'Results not found for this student' });

    const marks = {};
    if (result.marks && typeof result.marks === 'object') {
      Object.assign(marks, result.marks);
    }

    const subjectColumns = [
      ['Physics', result.physics],
      ['Chemistry', result.chemistry],
      ['Mathematics', result.mathematics],
      ['Biology', result.biology],
      ['Computer Science', result.computer_science],
      ['English', result.english],
      ['Kannada', result.kannada]
    ];

    subjectColumns.forEach(([subject, value]) => {
      if (value !== null && value !== undefined && value !== '') marks[subject] = value;
    });

    function parseYearFromClass(classGrade) {
      const s = String(classGrade || '').toLowerCase();
      if (/\b1\b|\b1st\b|first|year\s*1/.test(s)) return 1;
      if (/\b2\b|\b2nd\b|second|year\s*2/.test(s)) return 2;
      const m = s.match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
      return null;
    }

    const { data: sameYearStudents } = await supabase.from('students')
      .select('roll_no')
      .eq('class_grade', student.class_grade)
      .eq('stream', student.stream || 'Science');

    const sameYearRolls = (sameYearStudents || []).map(s => s.roll_no);

    let yearRank = null;
    if (sameYearRolls.length > 0) {
      const { data: yearResults } = await supabase.from('results').select('roll_no, total_marks').in('roll_no', sameYearRolls);
      const sorted = (yearResults || []).sort((a, b) => (b.total_marks || 0) - (a.total_marks || 0));
      const idx = sorted.findIndex(r => String(r.roll_no).toUpperCase() === String(normalizedRollNo).toUpperCase());
      if (idx >= 0) yearRank = idx + 1;
    }

    const { college_rank, stream_rank, ...resultWithoutRankFields } = result;

    res.json({ success: true, data: {
      ...resultWithoutRankFields,
      ...student,
      marks,
      total_marks: result.total_marks ?? null,
      percentage: result.percentage ?? null,
      rank: yearRank,
      stream: student.stream ?? result.stream ?? null,
      combination: student.combination ?? result.combination ?? null
    }});
  } catch (err) {
    console.error('[GET /api/student/result] failed', err);
    res.status(500).json({ error: 'Failed to fetch result' });
  }
});

app.listen(PORT, () => {
  console.log(`\n  🎓 Result Portal running at: http://localhost:${PORT}\n`);
});
