#!/usr/bin/env bash
set -euo pipefail

cd "$GITHUB_WORKSPACE"

# Under Github's software-only emulation (no KVM) adb connections can
# break right after boot while system_server settles, and system_server
# itself sometimes watchdog-restarts a minute or two after boot. Never
# call bare 'adb wait-for-device' (blocks forever) and never trust
# sys.boot_completed alone: gate on the settings provider answering.

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

# Wait until the settings provider answers: system_server can crash and
# restart after boot_completed is already 1, and commands like
# 'adb install' fail with 'Cannot access system provider' while it is
# coming back.
wait_settings() {
  for _ in $(seq 1 120); do
    if adb shell "settings get global device_provisioned" 2>/dev/null | tr -d '\r' | grep -q .; then
      return 0
    fi
    sleep 5
  done
  echo "::warning::settings provider never answered, continuing anyway"
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
wait_settings

CERT="$(basename "$CI_CA_FILE")"

# Install the CI CA into the system trust store WITHOUT a reboot.
# 'adb reboot' kills this emulator outright on the KVM-less runners
# (seen twice) and dm-verity blocks plain writes into /system. What
# works is stacking a tmpfs over the cacerts directory and copying
# the existing certs plus our CA into it; apps that start afterwards
# (the APK is installed later in this script) pick the store up.
# The conscrypt APEX store only exists on API 34+, skip it fast on
# this API 30 image so the failed push does not stall for a minute.

adb shell "mkdir -p /data/local/tmp/cacerts && cp /system/etc/security/cacerts/* /data/local/tmp/cacerts/ 2>/dev/null; true" || true

seed_store() {
  local DIR="$1"
  adb shell "test -d '$DIR'" >/dev/null 2>&1 || return 1
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

# Animations off, best effort; the settings provider can be down while
# system_server restarts, so keep retrying without failing the job.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if adb shell "settings put global window_animation_scale 0.0; settings put global transition_animation_scale 0.0; settings put global animator_duration_scale 0.0" 2>/dev/null; then
    echo "Animations disabled"
    break
  fi
  echo "::warning::animation scale write failed, waiting for the system to settle"
  wait_settings
  sleep 5
done

APK="$(find "$PWD/apk" -name '*.apk' -type f | head -n 1)"
echo "Installing $APK"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if adb install -r "$APK"; then
    INSTALLED=1
    break
  fi
  echo "::warning::install attempt failed, waiting for the system to settle"
  wait_settings
  sleep 10
done
if [ -z "${INSTALLED:-}" ]; then
  echo "::error::APK never installed"
  exit 1
fi

curl -fsSL "https://get.maestro.mobile.dev" | bash
export PATH="$HOME/.maestro/bin:$PATH"
maestro --version

cd ci/pr-3510
maestro test flow.yaml -e APP_ID=org.SparkyApps.SparkyFitnessMobile1.dev -o "$GITHUB_WORKSPACE/maestro-out"

mkdir -p "$GITHUB_WORKSPACE/screenshots"
find "$GITHUB_WORKSPACE/maestro-out" -name "*.png" | xargs -I{} cp -v {} "$GITHUB_WORKSPACE/screenshots/"

