#!/usr/bin/env bash
set -euo pipefail
cd /workspace/HUMAN-AGENT-LOOP
export npm_config_cache="$PWD/.local/npm-cache"
export npm_config_update_notifier=false
node --input-type=module -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<13)) throw new Error("Node.js >=22.13 is required"); console.log("Node",process.versions.node);'
npm --prefix Front ci --no-audit --no-fund
npm run build
