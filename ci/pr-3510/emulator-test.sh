#!/usr/bin/env bash
set -euo pipefail

cd "$GITHUB_WORKSPACE"

adb root
adb wait-for-device

# Trust the CI CA as a system certificate so the app accepts the
# self-signed TLS front. Push before the app's first launch.
adb remount || {
  adb disable-verity
  adb reboot
  adb wait-for-device
  adb root
  sleep 5
  adb remount
}
adb push "$CI_CA_FILE" /system/etc/security/cacerts/
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
