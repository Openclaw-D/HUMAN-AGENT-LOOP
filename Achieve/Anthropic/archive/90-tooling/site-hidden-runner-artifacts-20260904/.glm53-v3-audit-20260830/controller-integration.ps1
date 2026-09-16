$ErrorActionPreference = 'Stop'
node --experimental-strip-types --test ./test/api-route-source-contract.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
