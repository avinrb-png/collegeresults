ALTER TABLE results
  ADD COLUMN IF NOT EXISTS exam_type text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS total_max_marks integer NOT NULL DEFAULT 225;