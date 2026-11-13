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

CERT="$(basename "$CI_CA_FILE")"

# Install the CI CA into the system trust store WITHOUT a reboot.
# 'adb reboot' kills this emulator outright on the KVM-less runners
# (seen twice), and dm-verity blocks plain writes into /system, so
# neither the push-after-remount nor the reboot dance works. What does
# work is stacking a tmpfs over the cacerts directories and copying
# the existing certs plus our CA into it; apps that start afterwards
# (the APK is installed later in this script) pick the store up.
# API 30 keeps the live store in the conscrypt APEX, so try that
# path first and fall back to the legacy /system location.

adb shell "mkdir -p /data/local/tmp/cacerts && cp /apex/com.android.conscrypt/cacerts/* /data/local/tmp/cacerts/ 2>/dev/null; cp /system/etc/security/cacerts/* /data/local/tmp/cacerts/ 2>/dev/null; true" || true

seed_store() {
  local DIR="$1"
  adb shell "mount -t tmpfs tmpfs '$DIR'" >/dev/null 2>&1 || return 1
  adb shell "cp /data/local/tmp/cacerts/* '$DIR'/" >/dev/null 2>&1 || true
  adb push "$CI_CA_FILE" "$DIR/" >/dev/null 2>&1 || return 1
  adb shell "ls '$DIR/$CERT'" >/dev/null 2>&1
}

STORE=""
for D in /apex/com.android.conscrypt/cacerts /system/etc/security/cacerts; do
  if seed_store "$D"; then
    echo "CA installed into $D"
    STORE="$D"
    break
  fi
  echo "::warning::could not seed $D"
done

if [ -z "$STORE" ]; then
  echo "::warning::no cacerts store could be seeded; TLS to 10.0.2.2 will likely fail"
else
  adb shell "ls -la $STORE/$CERT"
  adb shell "ls $STORE | wc -l"
fi

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

