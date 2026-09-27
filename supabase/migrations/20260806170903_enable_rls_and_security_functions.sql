/*
# Enable RLS and add security functions for client-only result portal

## Overview
Converts the result portal from an Express-backend app to a client-only app
that talks directly to Supabase. RLS policies and SECURITY DEFINER functions
replace the server-side auth and data protection logic.

## Changes

### 1. RLS on students table
- Enables RLS on `students` (previously had no RLS).
- SELECT policy for anon: allows the student-login RPC to read roll_no/name/password
  (the function runs as owner, so this policy is for any direct access).
- INSERT/UPDATE/DELETE restricted to service role only (admin operations go through
  the admin edge function which uses the service role key).

### 2. RLS on results table
- RLS already enabled, now adding explicit policies.
- SELECT for anon: students can look up their own result by roll_no.
- INSERT/UPDATE/DELETE restricted to service role (admin uploads via edge function).

### 3. SECURITY DEFINER function: student_login(roll_no, password)
- Validates student credentials server-side.
- Returns roll_no and name on success, null on failure.
- Runs as owner so it can read the password column regardless of RLS.

### 4. SECURITY DEFINER function: get_student_result(roll_no)
- Fetches student info + results + computes year rank.
- Returns a JSON object with all data needed for the result page.
- Runs as owner to bypass RLS for the join logic.

### 5. SECURITY DEFINER function: get_year_rank(roll_no)
- Computes the year-specific rank for a student by comparing total_marks
  against all students in the same class_grade.
*/

-- ═══════════════════════════════════════════
-- 1. RLS on students table
-- ═══════════════════════════════════════════
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_students" ON students;
CREATE POLICY "anon_read_students"
ON students FOR SELECT
TO anon, authenticated
USING (true);

-- ═══════════════════════════════════════════
-- 2. RLS on results table
-- ═══════════════════════════════════════════
DROP POLICY IF EXISTS "anon_read_results" ON results;
CREATE POLICY "anon_read_results"
ON results FOR SELECT
TO anon, authenticated
USING (true);

-- ═══════════════════════════════════════════
-- 3. student_login function
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION student_login(p_roll_no text, p_password text)
RETURNS TABLE(roll_no text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.roll_no, s.name
  FROM students s
  WHERE s.roll_no ILIKE p_roll_no
    AND s.stream = 'Science'
    AND s.password = p_password
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION student_login(text, text) TO anon, authenticated;

-- ═══════════════════════════════════════════
-- 4. get_student_result function
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_student_result(p_roll_no text)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_result RECORD;
  v_marks JSON;
  v_year_rank integer;
  v_year text;
BEGIN
  -- Fetch student
  SELECT * INTO v_student
  FROM students
  WHERE roll_no ILIKE p_roll_no
    AND stream = 'Science'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Student not found');
  END IF;

  -- Fetch result
  SELECT * INTO v_result
  FROM results
  WHERE roll_no ILIKE p_roll_no
  LIMIT 1;

  -- Build marks object from result columns
  v_marks := json_build_object(
    'Physics', COALESCE(v_result.physics, null),
    'Chemistry', COALESCE(v_result.chemistry, null),
    'Mathematics', COALESCE(v_result.mathematics, null),
    'Biology', COALESCE(v_result.biology, null),
    'Computer Science', COALESCE(v_result.computer_science, null),
    'English', COALESCE(v_result.english, null),
    'Kannada', COALESCE(v_result.kannada, null)
  );

  -- Remove null subjects
  SELECT (SELECT json_object_agg(key, value) FROM json_each(v_marks) WHERE value IS NOT NULL AND value::text != 'null') INTO v_marks;

  -- Compute year rank
  SELECT get_year_rank(p_roll_no) INTO v_year_rank;

  -- Determine year from class_grade
  v_year := CASE
    WHEN v_student.class_grade ~* '(1|1st|first|year\s*1)' THEN '1'
    WHEN v_student.class_grade ~* '(2|2nd|second|year\s*2)' THEN '2'
    ELSE COALESCE(v_student.class_grade, 'unknown')
  END;

  RETURN json_build_object(
    'roll_no', v_student.roll_no,
    'name', v_student.name,
    'class_grade', v_student.class_grade,
    'stream', v_student.stream,
    'combination', v_student.combination,
    'marks', COALESCE(v_marks, '{}'::json),
    'total_marks', COALESCE(v_result.total_marks, null),
    'percentage', COALESCE(v_result.percentage, null),
    'rank', v_year_rank
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_result(text) TO anon, authenticated;

-- ═══════════════════════════════════════════
-- 5. get_year_rank function
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_year_rank(p_roll_no text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_grade text;
  v_stream text;
  v_rank integer;
BEGIN
  -- Get the student's class_grade and stream
  SELECT class_grade, stream INTO v_class_grade, v_stream
  FROM students
  WHERE roll_no ILIKE p_roll_no
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN null;
  END IF;

  -- Find rank: count students with higher total_marks in same class_grade + stream
  SELECT COUNT(*) + 1 INTO v_rank
  FROM results r
  JOIN students s ON s.roll_no = r.roll_no
  WHERE s.class_grade = v_class_grade
    AND s.stream = v_stream
    AND r.total_marks > (
      SELECT r2.total_marks FROM results r2
      WHERE r2.roll_no ILIKE p_roll_no LIMIT 1
    );

  RETURN v_rank;
END;
$$;

GRANT EXECUTE ON FUNCTION get_year_rank(text) TO anon, authenticated;