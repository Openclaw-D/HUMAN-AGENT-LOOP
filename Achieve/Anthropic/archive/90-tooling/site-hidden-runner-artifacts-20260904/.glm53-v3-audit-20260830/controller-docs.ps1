$ErrorActionPreference = 'Stop'
node --experimental-strip-types --test ./test/v3-shell-model.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
