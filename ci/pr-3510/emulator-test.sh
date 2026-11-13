#!/usr/bin/env bash
set -euo pipefail

cd "$GITHUB_WORKSPACE"

# Under Github's software-only emulation (no KVM) adb connections can
# break right after boot while system_server settles, so retry the
# early setup commands instead of failing the whole job on one bad
# pipe. Never call bare 'adb wait-for-device': it blocks forever when
# the emulator dies, which is what burned the first run of this job.

wait_boot() {
  for _ in $(seq 1 200); do
    STATE="$(adb get-state 2>/dev/null || true)"
    if [ "$STATE" = "device" ]; then
      BOOT="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
      if [ "$BOOT" = "1" ]; then return 0; fi
    fi
    sleep 3
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
sleep 5

# Install the CI CA as a system certificate so the app accepts the
# self-signed TLS front. The emulator runs with -writable-system, so
# after 'adb root' the overlayfs remount usually makes /system
# writable straight away and NO reboot is needed. Rebooting on the
# KVM-less runners is slow and has killed the emulator outright, so
# only fall back to it if the direct push does not stick.
adb remount || true
adb shell "mount -o rw,remount / 2>/dev/null; mount -o rw,remount /system 2>/dev/null; true" || true

CERT="$(basename "$CI_CA_FILE")"

ca_present() {
  adb shell "ls /system/etc/security/cacerts/$CERT 2>/dev/null" 2>/dev/null | grep -q .
}

push_ca() {
  adb push "$CI_CA_FILE" /system/etc/security/cacerts/ 2>/dev/null
}

if ! { push_ca && ca_present; }; then
  echo "::warning::direct CA push failed, trying once more after remount"
  adb remount || true
  sleep 5
fi

if ! ca_present && ! { push_ca && ca_present; }; then
  echo "::warning::CA still missing, rebooting once as last resort"
  adb reboot || true
  wait_boot
  retry adb root || true
  wait_boot
  sleep 5
  adb remount || true
  push_ca || true
fi

adb shell "ls -la /system/etc/security/cacerts/$CERT"
adb shell "ls /system/etc/security/cacerts/ | wc -l"

# Animations off, best effort.
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

