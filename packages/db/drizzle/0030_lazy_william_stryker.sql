ALTER TABLE "attendance_summary" ADD COLUMN "days_half_day" smallint DEFAULT 0 NOT NULL;

-- Backfill the new display bucket for existing summaries. This reads the
-- authoritative daily layer (hard rule 5), never attendance_records, and
-- fills each period shape from its own date window. New marks keep the bucket
-- current through recomputeSummaries.
UPDATE "attendance_summary" AS s
SET "days_half_day" = c.n
FROM (
  SELECT
    student_id,
    academic_year_id,
    EXTRACT(MONTH FROM date)::smallint AS m,
    EXTRACT(YEAR FROM date)::smallint AS y,
    count(*)::smallint AS n
  FROM "daily_attendance_status"
  WHERE status = 'half_day'
  GROUP BY student_id, academic_year_id, m, y
) AS c
WHERE s.period_type = 'monthly'
  AND s.student_id = c.student_id
  AND s.academic_year_id = c.academic_year_id
  AND s.month = c.m
  AND s.year = c.y;

UPDATE "attendance_summary" AS s
SET "days_half_day" = c.n
FROM (
  SELECT
    das.student_id,
    das.academic_year_id,
    t.id AS term_id,
    count(*)::smallint AS n
  FROM "daily_attendance_status" AS das
  INNER JOIN "terms" AS t
    ON t.academic_year_id = das.academic_year_id
   AND das.date >= t.start_date
   AND das.date <= t.end_date
  WHERE das.status = 'half_day'
  GROUP BY das.student_id, das.academic_year_id, t.id
) AS c
WHERE s.period_type = 'term'
  AND s.student_id = c.student_id
  AND s.academic_year_id = c.academic_year_id
  AND s.term_id = c.term_id;

UPDATE "attendance_summary" AS s
SET "days_half_day" = c.n
FROM (
  SELECT student_id, academic_year_id, count(*)::smallint AS n
  FROM "daily_attendance_status"
  WHERE status = 'half_day'
  GROUP BY student_id, academic_year_id
) AS c
WHERE s.period_type = 'annual'
  AND s.student_id = c.student_id
  AND s.academic_year_id = c.academic_year_id;