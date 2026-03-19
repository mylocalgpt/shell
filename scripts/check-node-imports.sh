#!/usr/bin/env bash
# Verify core dist files have no node: imports (overlay is excluded since it intentionally uses node:fs/path)
set -euo pipefail

if grep -rE "(from|require\()\s*['\"]node:" dist/ --include='*.mjs' --include='*.cjs' --include='*.js' --exclude-dir=overlay 2>/dev/null; then
  echo "ERROR: found node: imports in dist/ (overlay excluded)"
  exit 1
fi
