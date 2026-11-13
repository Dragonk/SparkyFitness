/**
 * Seeds a demo account with one saved workout preset and one active weekly
 * prefill workout plan, for the #1995 phase 2 screenshots (managing workout
 * plans on the device).
 *
 * Intended for the ci/phase2-e2e emulator workflow; runs against a freshly
 * migrated local server:
 *   pnpm exec tsx ci/phase2/seed.ts
 */
const BASE = process.env.SEED_BASE_URL ?? 'http://127.0.0.1:3010';
const ORIGIN = process.env.SEED_ORIGIN ?? 'https://10.0.2.2:8443';
const EMAIL = 'demo@example.com';
const PASSWORD = 'SparkyDemo2026!';

async function api(path: string, init?: RequestInit): Promise<any> {
  // Better Auth refuses auth POSTs without an Origin; send the CI
  // frontend origin the server already trusts via SPARKY_FITNESS_FRONTEND_URL.
  const headers = new Headers(init?.headers);
  headers.set('Origin', ORIGIN);
  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(path + ' -> ' + res.status + ': ' + text.slice(0, 400));
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  // 1. Sign up (fall back to sign-in when the account already exists).
  const authInit: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Demo User',
      email: EMAIL,
      password: PASSWORD,
    }),
  };
  let auth: any;
  try {
    auth = await api('/api/auth/sign-up/email', authInit);
  } catch (err) {
    console.log('sign-up failed (' + String(err).slice(0, 120) + '), trying sign-in');
    auth = await api('/api/auth/sign-in/email', authInit);
  }
  const token: string = auth.token;
  const authHeaders = { Authorization: 'Bearer ' + token };

  // 2. A custom exercise to hang the demo plan data on.
  const form = new FormData();
  form.append(
    'exerciseData',
    JSON.stringify({
      name: 'Demo Goblet Squat',
      description: 'Demo exercise for the #1995 phase 2 screenshots',
      category: 'strength',
      equipment: ['bodyweight'],
      is_custom: true,
      shared_with_public: false,
      source: 'custom',
    })
  );
  const exercise = await api('/api/exercises/', {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  const exerciseId: string = exercise.id;
  console.log('exercise created: ' + exerciseId);

  // 3. A saved workout the plan can reference.
  const preset = await api('/api/workout-presets', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Phase 2 Push Day',
      description: 'Seeded saved workout for the #1995 phase 2 screenshots',
      exercises: [
        {
          exercise_id: exerciseId,
          sort_order: 0,
          sets: [
            { set_number: 1, reps: 8, weight: 20, rest_time: 90 },
            { set_number: 2, reps: 8, weight: 20, rest_time: 90 },
          ],
        },
      ],
    }),
  });
  console.log('preset created: ' + preset.id);

  // 4. An active weekly prefill plan on Monday: the flow toggles it off,
  //    edits the assignments and re-activates it, which regenerates the
  //    upcoming planned sessions.
  const today = new Date().toISOString().slice(0, 10);
  const plan = await api('/api/workout-plan-templates', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan_name: 'Phase 2 Weekly Plan',
      description: 'Seeded active weekly plan for the #1995 phase 2 screenshots',
      start_date: today,
      end_date: null,
      is_active: true,
      schedule_type: 'weekly',
      entry_mode: 'prefill',
      currentClientDate: today,
      assignments: [
        {
          day_of_week: 1,
          session_index: null,
          session_name: null,
          sort_order: 0,
          workout_preset_id: String(preset.id),
          sets: [],
        },
      ],
    }),
  });
  console.log('plan created: ' + plan.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

