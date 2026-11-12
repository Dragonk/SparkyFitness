#!/usr/bin/env bash
set -euo pipefail

cd "$GITHUB_WORKSPACE"

wait_boot() {
  adb wait-for-device || true
  for _ in $(seq 1 90); do
    BOOT="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [ "$BOOT" = "1" ]; then return 0; fi
    sleep 2
  done
  echo "::warning::sys.boot_completed never reached, continuing anyway"
  return 0
}

adb root || true
wait_boot

# Install the CI CA as a system certificate so the app accepts the
# self-signed TLS front. Current emulator images ship with verity
# enabled, so the first remount only disables it; the device must
# reboot before /system is really writable. Reboot unconditionally:
# it is harmless when -writable-system already did the job.
adb remount || true
adb reboot || true
wait_boot
adb root || true
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
