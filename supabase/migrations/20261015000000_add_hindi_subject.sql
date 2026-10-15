ALTER TABLE results
  ADD COLUMN IF NOT EXISTS hindi integer;

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
BEGIN
  SELECT * INTO v_student
  FROM students
  WHERE roll_no ILIKE p_roll_no
    AND stream = 'Science'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Student not found');
  END IF;

  SELECT * INTO v_result
  FROM results
  WHERE roll_no ILIKE p_roll_no
  LIMIT 1;

  v_marks := json_build_object(
    'Physics', v_result.physics,
    'Chemistry', v_result.chemistry,
    'Mathematics', v_result.mathematics,
    'Biology', v_result.biology,
    'Computer Science', v_result.computer_science,
    'English', v_result.english,
    'Hindi', v_result.hindi,
    'Kannada', v_result.kannada
  );

  SELECT (
    SELECT json_object_agg(key, value)
    FROM json_each(v_marks)
    WHERE value IS NOT NULL AND value::text != 'null'
  ) INTO v_marks;

  SELECT get_year_rank(p_roll_no) INTO v_year_rank;

  RETURN json_build_object(
    'roll_no', v_student.roll_no,
    'name', v_student.name,
    'class_grade', v_student.class_grade,
    'stream', v_student.stream,
    'combination', v_student.combination,
    'marks', COALESCE(v_marks, '{}'::json),
    'total_marks', v_result.total_marks,
    'total_max_marks', v_result.total_max_marks,
    'exam_type', v_result.exam_type,
    'percentage', v_result.percentage,
    'rank', v_year_rank
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_student_result(text) TO anon, authenticated;
