#!/usr/bin/env bash
# Build the npm tarball and smoke-test the CLI exactly as a consumer receives it.
set -euo pipefail

archive=''
tmpdir=$(mktemp -d)
cleanup() {
  [[ -n "$archive" ]] && rm -f "$archive"
  rm -rf "$tmpdir"
}
trap cleanup EXIT

archive=$(npm pack --json | node -e "let input=''; process.stdin.on('data', chunk => input += chunk).on('end', () => console.log(JSON.parse(input)[0].filename))")
consumer="$tmpdir/consumer"
# Install normally so native dependency install scripts run just as they do for users.
npm install --omit=dev --prefix "$consumer" "$(pwd)/$archive" >/dev/null

for bin in oura oura-cli; do
  "$consumer/node_modules/.bin/$bin" --help >/dev/null
  "$consumer/node_modules/.bin/$bin" --version >/dev/null
done
# keytar is an optional dependency; when npm installs it, verify its install
# script supplied the native binding. Tolerate platforms where npm skipped it.
# Do not load it here: Linux CI deliberately lacks libsecret, and the CLI
# falls back when no keyring is available.
if [ -d "$consumer/node_modules/keytar" ]; then
  test -f "$consumer/node_modules/keytar/build/Release/keytar.node"
fi
node -e '
  const pkg = require(process.argv[1]);
  const ok =
    pkg.name === "@crcatala/oura-cli" &&
    pkg.bin?.oura &&
    pkg.bin?.["oura-cli"] &&
    pkg.files?.includes("dist");
  if (!ok) process.exit(1)
' "$consumer/node_modules/@crcatala/oura-cli/package.json"

echo 'Package smoke test passed.'
