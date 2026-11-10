/**
 * Seeds a demo account and three workout sessions that cover every derived
 * lifecycle status from #1995 phase 1 (partial, in progress, completed).
 *
 * Intended for the ci/pr-3510-e2e emulator workflow; runs against a freshly
 * migrated local server:
 *   pnpm exec tsx ci/pr-3510/seed.ts
 */
const BASE = process.env.SEED_BASE_URL ?? 'http://127.0.0.1:3010';
const EMAIL = 'demo@example.com';
const PASSWORD = 'SparkyDemo2026!';

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(BASE + path, init);
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

  // 2. A custom exercise to hang the demo sessions on.
  const form = new FormData();
  form.append(
    'exerciseData',
    JSON.stringify({
      name: 'Demo Goblet Squat',
      description: 'Demo exercise for the #1995 phase 1 screenshots',
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

  const today = new Date().toISOString().slice(0, 10);
  const t = (minutesAgo: number) =>
    new Date(Date.now() - minutesAgo * 60_000).toISOString();

  const sessionRequest = (
    name: string,
    sets: Array<{ reps: number; completedMinutesAgo: number | null }>,
    finishedAgo: number | null
  ) => ({
    entry_date: today,
    name,
    source: 'sparky',
    ...(finishedAgo != null ? { finished_at: t(finishedAgo) } : {}),
    exercises: [
      {
        exercise_id: exerciseId,
        sets: sets.map((set, index) => ({
          set_number: index + 1,
          reps: set.reps,
          weight: 24,
          ...(set.completedMinutesAgo != null
            ? { completed_at: t(set.completedMinutesAgo) }
            : {}),
        })),
      },
    ],
  });

  const createSession = (payload: unknown) =>
    api('/api/exercise-preset-entries', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  // Partial: finished, but the last set never happened.
  const partial = await createSession(
    sessionRequest(
      'Phase 1 Partial Workout',
      [
        { reps: 10, completedMinutesAgo: 40 },
        { reps: 10, completedMinutesAgo: 30 },
        { reps: 10, completedMinutesAgo: null },
      ],
      25
    )
  );

  // In progress: live session with the first set done.
  const inProgress = await createSession(
    sessionRequest(
      'Phase 1 Live Workout',
      [
        { reps: 10, completedMinutesAgo: 12 },
        { reps: 10, completedMinutesAgo: null },
      ],
      null
    )
  );

  // Completed: finished with every set done.
  const completed = await createSession(
    sessionRequest(
      'Phase 1 Done Workout',
      [
        { reps: 10, completedMinutesAgo: 95 },
        { reps: 10, completedMinutesAgo: 85 },
      ],
      80
    )
  );

  const summary = [
    { label: 'partial', session: partial },
    { label: 'in_progress', session: inProgress },
    { label: 'completed', session: completed },
  ];
  for (const item of summary) {
    console.log(
      item.label +
        ' -> name=' + item.session.name +
        ' status=' + item.session.status +
        ' revision=' + item.session.revision +
        ' finished_at=' + item.session.finished_at
    );
  }

  const mismatch = summary.find(
    (item) => String(item.session.status) !== item.label
  );
  if (mismatch) {
    throw new Error(
      'derived status mismatch for ' + mismatch.label +
      ': got ' + mismatch.session.status
    );
  }
  console.log('seed OK: all three derived statuses are as expected');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

