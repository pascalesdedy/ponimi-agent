#!/bin/sh
# Run Playwright test inside Docker sandbox
# Copies files to /tmp for writable execution

SCRIPT_FILE="$1"
if [ -z "$SCRIPT_FILE" ]; then
  echo "ERROR: Usage: run-playwright.sh <script-path>"
  exit 1
fi

if [ ! -f "$SCRIPT_FILE" ]; then
  echo "ERROR: Script not found: $SCRIPT_FILE"
  exit 1
fi

# Copy to writable /tmp
WORK_DIR="/tmp/pw-run-$$"
mkdir -p "$WORK_DIR"
cp "$SCRIPT_FILE" "$WORK_DIR/test.spec.ts"

# Use built-in config from image
CONFIG_FILE="/usr/local/share/pw.config.cjs"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Built-in config not found" >&2
  exit 1
fi

cp "$CONFIG_FILE" "$WORK_DIR/pw.config.cjs"

# Set NODE_PATH so @playwright/test resolves
export NODE_PATH=/usr/local/lib/node_modules

cd "$WORK_DIR"
npx playwright test --config=pw.config.cjs --reporter=json 2>&1
EXIT_CODE=$?

# Determine exit code based on JSON result
# Playwright exits 0 even if tests fail in JSON mode
# We check stdout for test status
if grep -q '"status":"passed"' "$WORK_DIR/test-results/.last-run.json" 2>/dev/null; then
  # At least some tests passed
  :
fi

# Cleanup
rm -rf "$WORK_DIR"

exit $EXIT_CODE
