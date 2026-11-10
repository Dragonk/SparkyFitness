-- Server-backed workout session lifecycle for grouped workout sessions
-- (exercise_preset_entries). The session status itself is derived from
-- started_at/finished_at and per-set completed_at data; only the lifecycle
-- timestamps and an optimistic-concurrency revision are stored.

ALTER TABLE public.exercise_preset_entries ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
COMMENT ON COLUMN public.exercise_preset_entries.started_at IS
  'When the workout was started (or resumed) via a lifecycle transition. NULL = not started yet (planned).';

ALTER TABLE public.exercise_preset_entries ADD COLUMN IF NOT EXISTS last_activity_at timestamp with time zone;
COMMENT ON COLUMN public.exercise_preset_entries.last_activity_at IS
  'Last time the session or any of its sets was modified. NULL = no activity yet.';

ALTER TABLE public.exercise_preset_entries ADD COLUMN IF NOT EXISTS finished_at timestamp with time zone;
COMMENT ON COLUMN public.exercise_preset_entries.finished_at IS
  'When the workout was ended. NULL = not finished. Splits partial from completed when combined with set completion data.';

ALTER TABLE public.exercise_preset_entries ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.exercise_preset_entries.revision IS
  'Optimistic concurrency counter. Incremented on every lifecycle transition and every session mutation; clients send expected_revision to detect stale writes.';
