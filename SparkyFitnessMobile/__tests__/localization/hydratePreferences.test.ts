/**
 * Regression tests for the Zustand persist hydration wait inside
 * `initializeAppLanguage` / `syncAppLanguageFromSystem` (issue #2253).
 *
 * The previous implementation created a Promise that was resolved by
 * `persist.onFinishHydration` but never rejected: if `persist.rehydrate()`
 * threw or its Promise rejected (storage failure, parse error, migration
 * throw), `onFinishHydration` never fired and the Promise hung forever,
 * leaving app bootstrap stuck behind a permanent splash screen.
 *
 * These tests mock the persist surface of `useAppPreferencesStore` so we can
 * exercise each terminal state of the wait without depending on real storage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { initializeAppLanguage } from '../../src/localization/appLanguage';
import i18n, { initializeI18n } from '../../src/localization/i18n';
import {
  __resetAppPreferencesStoreForTests,
  useAppPreferencesStore,
} from '../../src/stores/appPreferencesStore';
import { AppLanguageNative } from '../../src/services/appLanguageNative';

jest.mock('../../src/services/appLanguageNative', () => ({
  AppLanguageNative: {
    isAvailable: true,
    supportsNativePerAppLanguage: false,
    setApplicationLanguage: jest.fn(async () => undefined),
    getApplicationLanguage: jest.fn(async () => null),
    getEffectiveLanguage: jest.fn(async () => 'en'),
  },
}));

jest.mock('../../src/services/LogService', () => ({
  addLog: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [
    { languageCode: 'en', languageTag: 'en-US', regionCode: 'US', textDirection: 'ltr' },
  ]),
}));

const mockPersist = () => useAppPreferencesStore.persist;

/**
 * Replaces the persist API surface with a controllable double so each test
 * can decide how `rehydrate()` and `onFinishHydration()` behave. Returns
 * handles for assertions and manual triggers.
 */
function instrumentPersist(options?: {
  hasHydrated?: boolean;
  rehydrateImpl?: () => Promise<void> | void;
}) {
  const calls = {
    rehydrate: 0,
    onFinishHydration: 0,
    unsubscribed: 0,
  };

  const persistApi = mockPersist();

  const originalHasHydrated = persistApi.hasHydrated.bind(persistApi);
  const originalRehydrate = persistApi.rehydrate.bind(persistApi);
  const originalOnFinishHydration = persistApi.onFinishHydration.bind(persistApi);

  // Force `hasHydrated()` to return false so the wait code path runs.
  persistApi.hasHydrated = () => false;

  // Replace rehydrate with either the test-provided impl or the original.
  persistApi.rehydrate = options?.rehydrateImpl
    ? () => {
        calls.rehydrate++;
        return options.rehydrateImpl!();
      }
    : () => {
        calls.rehydrate++;
        return originalRehydrate();
      };

  let activeListener: (() => void) | null = null;
  persistApi.onFinishHydration = ((fn: () => void) => {
    calls.onFinishHydration++;
    activeListener = fn;
    return () => {
      calls.unsubscribed++;
      activeListener = null;
    };
  }) as typeof persistApi.onFinishHydration;

  return {
    calls,
    /** Manually fire the active onFinishHydration listener (simulates hydration completing). */
    fireHydration: () => {
      if (activeListener) activeListener();
    },
    /** Whether a listener is currently registered. */
    hasListener: () => activeListener !== null,
    restore() {
      persistApi.hasHydrated = originalHasHydrated;
      persistApi.rehydrate = originalRehydrate;
      persistApi.onFinishHydration = originalOnFinishHydration;
      activeListener = null;
    },
  };
}

/**
 * Wait a few microtask ticks so the serialized language operation chain in
 * `initializeAppLanguage` can progress to the point where `hydratePreferences`
 * has registered its `onFinishHydration` listener. `initializeAppLanguage`
 * chains on `languageOperation` (initially `Promise.resolve()`), so the
 * listener is registered after at least one microtask tick.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('hydratePreferences / initializeAppLanguage hydration wait (issue #2253)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    __resetAppPreferencesStoreForTests();
    jest.replaceProperty(Platform, 'OS', 'android');
    (AppLanguageNative as jest.Mocked<typeof AppLanguageNative>).supportsNativePerAppLanguage = false;
    await initializeI18n('en');
    await i18n.changeLanguage('en');
  });

  it('resolves when onFinishHydration fires after a successful manual rehydrate', async () => {
    const inst = instrumentPersist({
      rehydrateImpl: () => Promise.resolve(),
    });

    const promise = initializeAppLanguage();

    // Let the serialized operation chain run up to hydratePreferences.
    await flushMicrotasks();

    // The listener is now registered before we trigger completion.
    expect(inst.hasListener()).toBe(true);

    // Simulate Zustand finishing hydration.
    inst.fireHydration();

    await expect(promise).resolves.toBe('en');
    expect(inst.calls.rehydrate).toBe(1);
    expect(inst.calls.onFinishHydration).toBe(1);
    expect(inst.calls.unsubscribed).toBe(1);
    expect(inst.hasListener()).toBe(false);

    inst.restore();
  });

  it('rejects when rehydrate() returns a rejected Promise (no permanent hang)', async () => {
    const inst = instrumentPersist({
      rehydrateImpl: () => Promise.reject(new Error('storage corrupted')),
    });

    const promise = initializeAppLanguage();

    await expect(promise).rejects.toThrow('storage corrupted');

    // The listener was cleaned up even on the rejection path.
    expect(inst.calls.unsubscribed).toBe(1);
    expect(inst.hasListener()).toBe(false);
    expect(inst.calls.rehydrate).toBe(1);

    inst.restore();
  });

  it('rejects when rehydrate() throws synchronously (no permanent hang)', async () => {
    const inst = instrumentPersist({
      rehydrateImpl: () => {
        throw new Error('sync boom');
      },
    });

    const promise = initializeAppLanguage();

    await expect(promise).rejects.toThrow('sync boom');
    expect(inst.calls.unsubscribed).toBe(1);
    expect(inst.hasListener()).toBe(false);

    inst.restore();
  });

  it('does not leave the listener registered after a successful hydration', async () => {
    const inst = instrumentPersist({
      rehydrateImpl: () => Promise.resolve(),
    });

    const promise = initializeAppLanguage();
    await flushMicrotasks();
    inst.fireHydration();
    await promise;

    // After success there must be no dangling listener.
    expect(inst.hasListener()).toBe(false);
    expect(inst.calls.unsubscribed).toBe(1);

    inst.restore();
  });

  it('does not double-resolve if onFinishHydration fires after rehydrate already rejected', async () => {
    let rejectFn: ((err: Error) => void) | null = null;
    const inst = instrumentPersist({
      rehydrateImpl: () =>
        new Promise<void>((_resolve, reject) => {
          rejectFn = reject;
        }),
    });

    const promise = initializeAppLanguage();
    await flushMicrotasks();
    expect(inst.hasListener()).toBe(true);

    // Reject rehydrate first.
    rejectFn!(new Error('rehydrate failed'));
    await expect(promise).rejects.toThrow('rehydrate failed');

    // Late hydration event must NOT throw or resolve an already-settled promise.
    expect(() => inst.fireHydration()).not.toThrow();
    expect(inst.hasListener()).toBe(false);

    inst.restore();
  });

  it('bootstrap is never permanently pending: a rehydrate rejection propagates within the same tick', async () => {
    const inst = instrumentPersist({
      rehydrateImpl: () => Promise.reject(new Error('migration threw')),
    });

    const start = Date.now();
    const promise = initializeAppLanguage();

    await expect(promise).rejects.toThrow('migration threw');
    const elapsed = Date.now() - start;

    // Must settle in well under 5s; the old implementation would hang forever.
    expect(elapsed).toBeLessThan(5000);

    inst.restore();
  });
});
