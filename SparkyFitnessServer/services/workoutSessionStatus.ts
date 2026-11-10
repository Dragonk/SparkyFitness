export const WORKOUT_PLAN_SESSION_SOURCE = 'Workout Plan';

export type WorkoutSessionStatus =
  | 'planned'
  | 'in_progress'
  | 'partial'
  | 'completed';

export function isPlanGeneratedSession(
  source: string | null | undefined
): boolean {
  return source === WORKOUT_PLAN_SESSION_SOURCE;
}

/**
 * A set is "trackable" when it counts towards partial/completed derivation.
 * Warmup sets never count.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isTrackableSet(set: any): boolean {
  const setType = (set?.set_type ?? '').toString().toLowerCase();
  return !setType.includes('warmup');
}

/**
 * Derive the server-backed lifecycle status of a grouped workout session.
 *
 * Per the #1995 discussion, the status is never stored: plan-generated
 * sessions derive it from started_at/finished_at plus per-set completed_at,
 * while every directly logged session is reported as "completed" so it never
 * shows a misleading "planned" label.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deriveSessionStatus(session: any): WorkoutSessionStatus {
  if (!isPlanGeneratedSession(session?.source)) {
    return 'completed';
  }
  if (session?.finished_at) {
    const sets = (session.exercises ?? []).flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (exercise: any) => exercise.sets ?? []
    );
    const trackable = sets.filter(isTrackableSet);
    if (trackable.length === 0) {
      return 'completed';
    }
    const allCompleted = trackable.every(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (set: any) => set.completed_at != null
    );
    return allCompleted ? 'completed' : 'partial';
  }
  return session?.started_at ? 'in_progress' : 'planned';
}

/** Normalize a pg timestamp (Date | string | null) to an ISO string or null. */
function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Attach derived lifecycle fields (status + timestamps + revision) to a raw
 * exercise_preset_entries row that already carries its child exercises.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function attachSessionLifecycle(meta: any, exercises: any[] = []) {
  const session = { ...meta, exercises };
  return {
    status: deriveSessionStatus(session),
    started_at: toIsoTimestamp(meta.started_at),
    last_activity_at: toIsoTimestamp(meta.last_activity_at),
    finished_at: toIsoTimestamp(meta.finished_at),
    revision: Number(meta.revision ?? 0),
  };
}
