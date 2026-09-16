$ErrorActionPreference = 'Stop'
node --experimental-strip-types --test ./test/v3-demo-scenario.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
