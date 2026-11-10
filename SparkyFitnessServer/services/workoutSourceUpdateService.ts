import { getClient } from '../db/poolManager.js';
import { log } from '../config/logging.js';
import { getGroupedExerciseSessionById } from './exerciseEntryHistoryService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import {
  createExerciseEntriesFromTemplate,
  deleteExerciseEntriesByTemplateId,
} from '../models/exerciseTemplate.js';
import { resolveTemplateStartDay } from '../utils/timezoneLoader.js';
import { WORKOUT_PLAN_SESSION_SOURCE } from './workoutSessionStatus.js';

function createServiceError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

/** Programmed (non-execution) fields copied into a preset/plan source. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function programmedSet(set: any) {
  return {
    set_number: set.set_number,
    set_type: set.set_type ?? 'Working Set',
    reps: set.reps ?? null,
    weight: set.weight ?? null,
    duration: set.duration ?? null,
    rest_time: set.rest_time ?? null,
    notes: set.notes ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setsEqual(a: any, b: any): boolean {
  return (
    (a.reps ?? null) === (b.reps ?? null) &&
    Number(a.weight ?? 0) === Number(b.weight ?? 0) &&
    (a.duration ?? null) === (b.duration ?? null)
  );
}

/**
 * Find the workout plan assignment that generated this session (via any child
 * entry's workout_plan_assignment_id) and its owning template.
 */
async function findSourcePlanContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any
) {
  const result = await client.query(
    `SELECT DISTINCT ee.workout_plan_assignment_id AS assignment_id
     FROM exercise_entries ee
     WHERE ee.exercise_preset_entry_id = $1
       AND ee.workout_plan_assignment_id IS NOT NULL
     LIMIT 1`,
    [presetEntryId]
  );
  const assignmentId = result.rows[0]?.assignment_id;
  if (!assignmentId) return null;
  const planResult = await client.query(
    `SELECT a.id AS assignment_id, a.template_id, t.plan_name
     FROM workout_plan_template_assignments a
     JOIN workout_plan_templates t ON t.id = a.template_id
     WHERE a.id = $1 AND t.user_id = $2
     LIMIT 1`,
    [assignmentId, userId]
  );
  return planResult.rows[0] ?? null;
}

/**
 * Preview whether the finished session differs from its plan/preset source and
 * which target would be updated. Returns target null for non-plan sessions.
 */
export async function previewSourceUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any
) {
  const session = await getGroupedExerciseSessionById(userId, presetEntryId);
  if (!session) {
    throw createServiceError(404, 'Exercise preset entry not found.');
  }
  if (session.source !== WORKOUT_PLAN_SESSION_SOURCE) {
    return { target: null, differs: false, name: null };
  }
  const client = await getClient(userId);
  try {
    if (session.workout_preset_id) {
      const preset = await workoutPresetRepository.getWorkoutPresetById(
        session.workout_preset_id,
        userId
      );
      if (!preset) {
        return { target: 'preset', differs: true, name: null };
      }
      const presetSetsByExercise = new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (preset.exercises ?? []).map((e: any) => [e.exercise_id, e.sets ?? []])
      );
      let differs =
        (session.exercises ?? []).length !== (preset.exercises ?? []).length;
      if (!differs) {
        for (const ex of session.exercises ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const programmed = (presetSetsByExercise.get(ex.exercise_id) ??
            []) as any[];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const performed = (ex.sets ?? []).filter(
            (s: any) => s.completed_at !== null && s.completed_at !== undefined
          );
          if (performed.length !== programmed.length) {
            differs = true;
            break;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sortedProgrammed = [...programmed].sort(
            (a: any, b: any) => a.set_number - b.set_number
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sortedPerformed = [...performed].sort(
            (a: any, b: any) => a.set_number - b.set_number
          );
          for (let i = 0; i < sortedPerformed.length; i++) {
            if (!setsEqual(sortedPerformed[i], sortedProgrammed[i])) {
              differs = true;
              break;
            }
          }
          if (differs) break;
        }
      }
      return { target: 'preset' as const, differs, name: preset.name };
    }
    const planContext = await findSourcePlanContext(
      client,
      userId,
      presetEntryId
    );
    if (!planContext) {
      return { target: null, differs: false, name: null };
    }
    const assignmentResult = await client.query(
      `SELECT a.exercise_id, COALESCE((SELECT json_agg(s ORDER BY s.set_number) FROM workout_plan_assignment_sets s WHERE s.assignment_id = a.id), '[]'::json) AS sets
       FROM workout_plan_template_assignments a WHERE a.id = $1`,
      [planContext.assignment_id]
    );
    const assignment = assignmentResult.rows[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const performed = (session.exercises ?? []).find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => e.exercise_id === assignment?.exercise_id
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const performedCompleted = ((performed?.sets ?? []) as any[]).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => s.completed_at !== null && s.completed_at !== undefined
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const programmed = (assignment?.sets ?? []) as any[];
    const differs =
      !performed ||
      performedCompleted.length !== programmed.length ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      performedCompleted.some(
        (s: any, i: number) => !setsEqual(s, programmed[i])
      );
    return {
      target: 'plan-day' as const,
      differs,
      name: planContext.plan_name,
    };
  } finally {
    client.release();
  }
}

/**
 * Apply the source update for a finished plan-generated session:
 * - preset-backed sessions update the referenced Workout Preset;
 * - direct-exercise plan sessions update that day's assignment sets.
 * Only future untouched planned sessions are regenerated afterwards.
 */
export async function applySourceUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presetEntryId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: 'preset' | 'plan-day'
) {
  const client = await getClient(userId);
  try {
    await client.query('BEGIN');
    const session = await getGroupedExerciseSessionById(userId, presetEntryId);
    if (!session) {
      throw createServiceError(404, 'Exercise preset entry not found.');
    }
    if (session.source !== WORKOUT_PLAN_SESSION_SOURCE) {
      throw createServiceError(
        409,
        'Source updates are only available for Workout Plan sessions.'
      );
    }
    if (!session.finished_at) {
      throw createServiceError(
        409,
        'Finish the workout before updating its source.'
      );
    }

    let regeneratedTemplateIds: number[] = [];

    if (target === 'preset') {
      if (!session.workout_preset_id) {
        throw createServiceError(
          409,
          'This session is not backed by a Workout Preset.'
        );
      }
      const preset = await workoutPresetRepository.getWorkoutPresetById(
        session.workout_preset_id,
        userId
      );
      if (!preset) {
        throw createServiceError(404, 'Workout preset not found.');
      }
      // Performed exercises become the new preset content. Execution-only
      // data (completed_at, is_pr, calories) is never copied.
      const exercises = (session.exercises ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ex: any, index: number) => ({
          exercise_id: ex.exercise_id,
          image_url: ex.image_url ?? null,
          sort_order: ex.sort_order ?? index,
          superset_group: ex.superset_group ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sets: (ex.sets ?? []).map((s: any) => programmedSet(s)),
        })
      );
      await workoutPresetRepository.updateWorkoutPreset(
        session.workout_preset_id,
        userId,
        { exercises }
      );
      // Regenerate future planned sessions of active plans using this preset.
      const templatesResult = await client.query(
        `SELECT DISTINCT t.id FROM workout_plan_templates t
         JOIN workout_plan_template_assignments a ON a.template_id = t.id
         WHERE a.workout_preset_id = $1 AND t.user_id = $2 AND t.is_active = true`,
        [session.workout_preset_id, userId]
      );
      regeneratedTemplateIds = templatesResult.rows.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => r.id
      );
    } else {
      const planContext = await findSourcePlanContext(
        client,
        userId,
        presetEntryId
      );
      if (!planContext) {
        throw createServiceError(
          409,
          'This session is not backed by a direct plan assignment.'
        );
      }
      // Merge performed values into the assignment sets: completed sets copy
      // their performed reps/weight/duration; uncompleted sets keep the
      // programmed values.
      const assignmentResult = await client.query(
        `SELECT a.id, a.exercise_id,
                COALESCE((SELECT json_agg(s ORDER BY s.set_number) FROM workout_plan_assignment_sets s WHERE s.assignment_id = a.id), '[]'::json) AS sets
         FROM workout_plan_template_assignments a WHERE a.id = $1`,
        [planContext.assignment_id]
      );
      const assignment = assignmentResult.rows[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const performed = (session.exercises ?? []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.exercise_id === assignment?.exercise_id
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const performedCompleted = ((performed?.sets ?? []) as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (s: any) => s.completed_at !== null && s.completed_at !== undefined
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const programmed = (assignment?.sets ?? []) as any[];
      const merged = programmed.map((p: any, i: number) => {
        const done = performedCompleted[i];
        return done
          ? {
              ...p,
              reps: done.reps ?? p.reps,
              weight: done.weight ?? p.weight,
              duration: done.duration ?? p.duration,
            }
          : p;
      });
      await client.query(
        'DELETE FROM workout_plan_assignment_sets WHERE assignment_id = $1',
        [planContext.assignment_id]
      );
      for (const set of merged) {
        await client.query(
          `INSERT INTO workout_plan_assignment_sets (assignment_id, set_number, set_type, reps, weight, duration, rest_time, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            planContext.assignment_id,
            set.set_number,
            set.set_type ?? 'Working Set',
            set.reps ?? null,
            set.weight ?? null,
            set.duration ?? null,
            set.rest_time ?? null,
            set.notes ?? null,
          ]
        );
      }
      regeneratedTemplateIds = [planContext.template_id];
    }

    // Regenerate only future, untouched planned sessions of the affected plans.
    const today = await resolveTemplateStartDay(userId);
    for (const templateId of regeneratedTemplateIds) {
      const activeResult = await client.query(
        'SELECT is_active FROM workout_plan_templates WHERE id = $1 AND user_id = $2',
        [templateId, userId]
      );
      if (activeResult.rows[0]?.is_active) {
        await deleteExerciseEntriesByTemplateId(templateId, userId, today);
        await createExerciseEntriesFromTemplate(templateId, userId, today);
      }
    }

    await client.query('COMMIT');
    log(
      'info',
      `Applied source update (${target}) for session ${presetEntryId} by user ${userId}; regenerated templates: ${regeneratedTemplateIds.join(',') || 'none'}`
    );
    return { ok: true, target, regeneratedTemplateIds };
  } catch (error) {
    await client.query('ROLLBACK');
    log(
      'error',
      `Error applying source update for session ${presetEntryId}:`,
      error
    );
    throw error;
  } finally {
    client.release();
  }
}

export default { previewSourceUpdate, applySourceUpdate };
