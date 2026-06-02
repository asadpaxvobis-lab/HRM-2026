-- RUN IN SUPABASE SQL EDITOR (one time)
-- Auto PENDING overtime when attendance detects OT (ZKT / real-time punches).

\i supabase/migrations/0043_auto_overtime_from_attendance.sql

-- If \i fails in SQL editor, paste the full contents of 0043_auto_overtime_from_attendance.sql instead.

SELECT 'OK — auto overtime from attendance' AS step;
