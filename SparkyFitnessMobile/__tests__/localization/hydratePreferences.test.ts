/**
 * Regression tests for the Zustand persist hydration wait inside
 * `initializeAppLanguage` / `syncAppLanguageFromSystem` (issue #2253).
 *
 * The previous implementation awaited a Promise that was only resolved by
 * `persist.onFinishHydration` and never rejected. In Zustand 5.0.x a
 * storage/migration error is caught INTERNALLY by `hydrate()`: it does NOT
 * re-throw, leaves `hasHydrated()` false, and never fires the
 * `onFinishHydration` listeners — so the old Promise hung forever and app
 * bootstrap stayed stuck behind a permanent splash screen.
 *
 * The fix relies on the documented post-condition of `rehydrate()`: after it
 * settles, `hasHydrated()` is true iff hydration succeeded. These tests mock
 * the persist surface to exercise each terminal state without real storage.
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
 * can decide how `rehydrate()` behaves and what `hasHydrated()` reports after
 * it settles. This mirrors the two real Zustand 5.0.x outcomes:
 *
 *  - success: `rehydrate()` resolves and `hasHydrated()` becomes true.
 *  - internal failure: `rehydrate()` resolves (does NOT reject) but
 *    `hasHydrated()` stays false because hydrate() caught the error itself.
 *
 * An explicit rejection path is also supported for defensive coverage.
 */
function instrumentPersist(options: {
  initialHasHydrated?: boolean;
  /** Sets `hasHydrated()` to this value after `rehydrate()` settles. */
  hasHydratedAfter?: boolean;
  /** If provided, `rehydrate()` rejects with this error instead of resolving. */
  rehydrateRejectsWith?: Error;
}) {
  const calls = {
    rehydrate: 0,
  };

  const persistApi = mockPersist();
  const originalHasHydrated = persistApi.hasHydrated.bind(persistApi);
  const originalRehydrate = persistApi.rehydrate.bind(persistApi);

  let hydratedFlag = options.initialHasHydrated ?? false;

  persistApi.hasHydrated = () => hydratedFlag;

  persistApi.rehydrate = () => {
    calls.rehydrate++;
    if (options.rehydrateRejectsWith) {
      return Promise.reject(options.rehydrateRejectsWith);
    }
    // Simulate the async settle: after the microtask, flip hasHydrated to the
    // post-condition value (false on internal failure, true on success).
    return new Promise<void>((resolve) => {
      // Zustand resolves rehydrate() after its internal .then chain settles;
      // flip the flag on the next microtask so the await sees the final value.
      Promise.resolve().then(() => {
        hydratedFlag = options.hasHydratedAfter ?? true;
        resolve();
      });
    });
  };

  return {
    calls,
    restore() {
      persistApi.hasHydrated = originalHasHydrated;
      persistApi.rehydrate = originalRehydrate;
      hydratedFlag = false;
    },
  };
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

  it('1. already hydrated: rehydrate() is not called and init continues', async () => {
    // The store is already hydrated, so hydratePreferences() must short-circuit
    // without touching rehydrate(). This mirrors the common path where the
    // persist middleware auto-hydrated before initializeAppLanguage runs.
    const inst = instrumentPersist({ initialHasHydrated: true });

    await expect(initializeAppLanguage()).resolves.toBe('en');
    expect(inst.calls.rehydrate).toBe(0);

    inst.restore();
  });

  it('2. successful hydration: rehydrate() resolves and hasHydrated becomes true', async () => {
    const inst = instrumentPersist({
      initialHasHydrated: false,
      hasHydratedAfter: true,
    });

    await expect(initializeAppLanguage()).resolves.toBe('en');
    expect(inst.calls.rehydrate).toBe(1);
    expect(useAppPreferencesStore.persist.hasHydrated()).toBe(true);

    inst.restore();
  });

  it('3. Zustand internal failure: rehydrate() RESOLVES but hasHydrated stays false → init rejects (no permanent hang)', async () => {
    // This is the MOST IMPORTANT test. In Zustand 5.0.x a storage/migration
    // error is caught internally by hydrate(): rehydrate() resolves, but
    // hasHydrated() stays false and onFinishHydration never fires. The old
    // implementation would hang forever here; the fix detects the false
    // hasHydrated() and rejects so bootstrap can continue.
    const inst = instrumentPersist({
      initialHasHydrated: false,
      hasHydratedAfter: false, // internal failure: stays false
    });

    await expect(initializeAppLanguage()).rejects.toThrow('Failed to hydrate app preferences');
    expect(inst.calls.rehydrate).toBe(1);

    inst.restore();
  });

  it('4. defensive external rejection: rehydrate() rejects → rejection propagates (no hang)', async () => {
    // Zustand 5.0.x does not normally reject rehydrate() on storage errors, but
    // the await path must still propagate a rejection if it ever occurs.
    const inst = instrumentPersist({
      initialHasHydrated: false,
      rehydrateRejectsWith: new Error('storage corrupted'),
    });

    await expect(initializeAppLanguage()).rejects.toThrow('storage corrupted');
    expect(inst.calls.rehydrate).toBe(1);

    inst.restore();
  });

  it('5. bootstrap is never permanently pending: the Zustand-internal failure settles within the same tick', async () => {
    const inst = instrumentPersist({
      initialHasHydrated: false,
      hasHydratedAfter: false,
    });

    const start = Date.now();
    const promise = initializeAppLanguage();

    await expect(promise).rejects.toThrow('Failed to hydrate app preferences');
    const elapsed = Date.now() - start;

    // Must settle in well under 5s; the old implementation would hang forever.
    expect(elapsed).toBeLessThan(5000);

    inst.restore();
  });
});
