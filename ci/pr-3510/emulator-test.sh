#!/usr/bin/env bash
set -euo pipefail

cd "$GITHUB_WORKSPACE"

# Under Github's software-only emulation (no KVM) adb connections can
# break right after boot while system_server settles, so retry the
# early setup commands instead of failing the whole job on one bad
# pipe. The runner's own animation step is disabled for the same
# reason; we disable animations best-effort below.

wait_boot() {
  adb wait-for-device || true
  for _ in $(seq 1 120); do
    BOOT="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [ "$BOOT" = "1" ]; then return 0; fi
    sleep 2
  done
  echo "::warning::sys.boot_completed never reached, continuing anyway"
  return 0
}

retry() {
  for _ in 1 2 3 4 5; do
    if "$@" 2>/dev/null; then return 0; fi
    sleep 5
  done
  echo "::warning::command kept failing: $*"
  return 1
}

retry adb root || true
wait_boot

# Install the CI CA as a system certificate so the app accepts the
# self-signed TLS front. Current emulator images ship with verity
# enabled, so the first remount only disables it; the device must
# reboot before /system is really writable. Reboot unconditionally:
# it is harmless when -writable-system already did the job.
adb remount || true
adb reboot || true
wait_boot
retry adb root || true
wait_boot
sleep 3
adb remount || true
# system-as-root fallback: on API 30 images /system is part of the
# root mount, so remounting / flips it read-write too.
adb shell "mount -o rw,remount / 2>/dev/null; mount -o rw,remount /system 2>/dev/null; true" || true
adb push "$CI_CA_FILE" /system/etc/security/cacerts/
CERT="$(basename "$CI_CA_FILE")"
adb shell "ls -la /system/etc/security/cacerts/$CERT"
adb shell "ls /system/etc/security/cacerts/ | wc -l"

# Animations off, best effort (the runner step is disabled because it
# treats one broken pipe as a fatal error).
for _ in 1 2 3 4 5; do
  if adb shell "settings put global window_animation_scale 0.0; settings put global transition_animation_scale 0.0; settings put global animator_duration_scale 0.0" 2>/dev/null; then
    echo "Animations disabled"
    break
  fi
  echo "::warning::animation scale write failed, retrying"
  sleep 5
done

APK="$(find "$PWD/apk" -name '*.apk' -type f | head -n 1)"
echo "Installing $APK"
adb install -r "$APK"

curl -fsSL "https://get.maestro.mobile.dev" | bash
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version

cd ci/pr-3510
maestro test flow.yaml -e APP_ID=org.SparkyApps.SparkyFitnessMobile1.dev -o "$GITHUB_WORKSPACE/maestro-out"

mkdir -p "$GITHUB_WORKSPACE/screenshots"
find "$GITHUB_WORKSPACE/maestro-out" -name "*.png" | xargs -I{} cp -v {} "$GITHUB_WORKSPACE/screenshots/"
