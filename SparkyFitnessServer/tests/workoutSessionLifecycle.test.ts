import { vi, describe, expect, it } from 'vitest';
import {
  deriveSessionStatus,
  attachSessionLifecycle,
} from '../services/workoutSessionStatus.js';

vi.mock('../db/poolManager', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../config/logging', () => ({
  log: vi.fn(),
}));

const planMeta = {
  source: 'Workout Plan',
  started_at: null,
  finished_at: null,
  revision: 3,
};

const sets = (...completed: boolean[]) =>
  completed.map((c, i) => ({
    set_number: i + 1,
    set_type: 'Working Set',
    completed_at: c ? '2026-07-28T10:00:00.000Z' : null,
  }));

describe('deriveSessionStatus', () => {
  it('returns completed for directly logged (non-plan) sessions', () => {
    expect(
      deriveSessionStatus({ source: 'manual', started_at: null, exercises: [] })
    ).toBe('completed');
    expect(
      deriveSessionStatus({
        source: 'sparky',
        finished_at: null,
        exercises: [],
      })
    ).toBe('completed');
  });

  it('returns planned for a plan session that was never started', () => {
    expect(
      deriveSessionStatus({ ...planMeta, exercises: [{ sets: sets(false) }] })
    ).toBe('planned');
  });

  it('returns in_progress once started but not finished', () => {
    expect(
      deriveSessionStatus({
        ...planMeta,
        started_at: '2026-07-28T09:00:00.000Z',
        exercises: [{ sets: sets(true, false) }],
      })
    ).toBe('in_progress');
  });

  it('returns partial when ended with some but not all trackable sets completed', () => {
    expect(
      deriveSessionStatus({
        ...planMeta,
        started_at: '2026-07-28T09:00:00.000Z',
        finished_at: '2026-07-28T10:00:00.000Z',
        exercises: [{ sets: sets(true, false) }],
      })
    ).toBe('partial');
  });

  it('returns completed when ended with all trackable sets completed', () => {
    expect(
      deriveSessionStatus({
        ...planMeta,
        started_at: '2026-07-28T09:00:00.000Z',
        finished_at: '2026-07-28T10:00:00.000Z',
        exercises: [{ sets: sets(true, true) }],
      })
    ).toBe('completed');
  });

  it('ignores warmup sets when deriving completion', () => {
    expect(
      deriveSessionStatus({
        ...planMeta,
        started_at: '2026-07-28T09:00:00.000Z',
        finished_at: '2026-07-28T10:00:00.000Z',
        exercises: [
          {
            sets: [
              { set_number: 1, set_type: 'Warmup', completed_at: null },
              {
                set_number: 2,
                set_type: 'Working Set',
                completed_at: '2026-07-28T09:30:00.000Z',
              },
            ],
          },
        ],
      })
    ).toBe('completed');
  });

  it('treats a finished session with no trackable sets as completed', () => {
    expect(
      deriveSessionStatus({
        ...planMeta,
        started_at: '2026-07-28T09:00:00.000Z',
        finished_at: '2026-07-28T10:00:00.000Z',
        exercises: [{ sets: [] }],
      })
    ).toBe('completed');
  });
});

describe('attachSessionLifecycle', () => {
  it('normalizes pg timestamps to ISO strings and exposes revision', () => {
    const started = new Date('2026-07-28T09:00:00.000Z');
    const attached = attachSessionLifecycle(
      { ...planMeta, started_at: started, last_activity_at: started },
      [{ sets: sets(false) }]
    );
    expect(attached.status).toBe('in_progress');
    expect(attached.started_at).toBe('2026-07-28T09:00:00.000Z');
    expect(attached.last_activity_at).toBe('2026-07-28T09:00:00.000Z');
    expect(attached.finished_at).toBeNull();
    expect(attached.revision).toBe(3);
  });
});
