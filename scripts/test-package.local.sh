# Sourced by scripts/test-package.sh with $consumer set to the install prefix.
# oura-cli specific checks of the installed package.

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
