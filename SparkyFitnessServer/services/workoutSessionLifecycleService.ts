import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import { getGroupedExerciseSessionByIdWithClient } from './exerciseEntryHistoryService.js';
import {
  WORKOUT_PLAN_SESSION_SOURCE,
  deriveSessionStatus,
  attachSessionLifecycle,
} from './workoutSessionStatus.js';

function createServiceError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/**
 * Apply a lifecycle transition (start | resume | end) to a grouped workout
 * session. The server is authoritative: transitions are validated against the
 * current derived status, and an optional expected_revision guards against
 * stale concurrent writes (409 on mismatch).
 */
export async function transitionWorkoutSession(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transitionData: any
) {
  const { transition, expected_revision } = transitionData;
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id, source, started_at, last_activity_at, finished_at, revision
       FROM exercise_preset_entries
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [presetEntryId, userId]
    );
    if (locked.rows.length === 0) {
      throw createServiceError(404, 'Exercise preset entry not found.');
    }
    const row = locked.rows[0];
    if (
      expected_revision !== undefined &&
      expected_revision !== null &&
      Number(row.revision) !== Number(expected_revision)
    ) {
      throw createServiceError(
        409,
        `Revision conflict: session was modified elsewhere (expected revision ${expected_revision}, current ${row.revision}).`
      );
    }

    const session = await getGroupedExerciseSessionByIdWithClient(
      client,
      userId,
      presetEntryId
    );
    if (!session) {
      throw createServiceError(404, 'Exercise preset entry not found.');
    }
    const status = deriveSessionStatus({
      ...row,
      exercises: session.exercises,
    });

    let updates: Record<string, unknown> = {};
    if (transition === 'start') {
      if (status !== 'planned') {
        throw createServiceError(
          409,
          `Cannot start a workout with status '${status}'.`
        );
      }
      updates = {
        started_at: 'now()',
        finished_at: null,
        last_activity_at: 'now()',
      };
    } else if (transition === 'resume') {
      if (status !== 'partial') {
        throw createServiceError(
          409,
          `Cannot resume a workout with status '${status}'. Only partial workouts can be resumed.`
        );
      }
      updates = { finished_at: null, last_activity_at: 'now()' };
    } else if (transition === 'end') {
      if (status !== 'in_progress') {
        throw createServiceError(
          409,
          `Cannot end a workout with status '${status}'. Start it first.`
        );
      }
      updates = { finished_at: 'now()', last_activity_at: 'now()' };
    } else {
      throw createServiceError(400, `Unknown transition '${transition}'.`);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const [column, value] of Object.entries(updates)) {
      setClauses.push(`${column} = $${idx}`);
      values.push(value === 'now()' ? null : value);
      if (value === 'now()') {
        setClauses[setClauses.length - 1] = `${column} = now()`;
      }
      idx += 1;
    }
    setClauses.push(`revision = revision + 1`);
    setClauses.push(`updated_at = now()`);
    values.push(presetEntryId, userId);

    await client.query(
      `UPDATE exercise_preset_entries SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}`,
      values
    );

    const updated = await getGroupedExerciseSessionByIdWithClient(
      client,
      userId,
      presetEntryId
    );
    await client.query('COMMIT');
    return updated;
  } catch (error) {
    await client.query('ROLLBACK');
    log(
      'error',
      `Error transitioning workout session ${presetEntryId} (${transition}):`,
      error
    );
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bump revision + last_activity_at on a session mutation (e.g. PUT with set
 * edits). Returns false on revision conflict so callers can surface a 409.
 */
export async function touchSessionOnMutation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any,
  expectedRevision?: number | null
): Promise<boolean> {
  if (expectedRevision === undefined || expectedRevision === null) {
    await client.query(
      `UPDATE exercise_preset_entries
       SET revision = revision + 1, last_activity_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [presetEntryId, userId]
    );
    return true;
  }
  const result = await client.query(
    `UPDATE exercise_preset_entries
     SET revision = revision + 1, last_activity_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND revision = $3`,
    [presetEntryId, userId, expectedRevision]
  );
  return (result.rowCount ?? 0) > 0;
}

export {
  WORKOUT_PLAN_SESSION_SOURCE,
  deriveSessionStatus,
  attachSessionLifecycle,
};

export default {
  deriveSessionStatus,
  attachSessionLifecycle,
  transitionWorkoutSession,
  touchSessionOnMutation,
  WORKOUT_PLAN_SESSION_SOURCE,
};
