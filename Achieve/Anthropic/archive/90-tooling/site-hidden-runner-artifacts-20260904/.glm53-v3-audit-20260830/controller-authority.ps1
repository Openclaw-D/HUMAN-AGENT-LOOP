$ErrorActionPreference = 'Stop'
node --experimental-strip-types --test ./test/backend-authority-integration.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
