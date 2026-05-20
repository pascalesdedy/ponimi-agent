#!/bin/sh
set -eu

PLAYWRIGHT_CORE_JSON="/usr/local/lib/node_modules/@playwright/test/node_modules/playwright-core/browsers.json"

if [ ! -f "$PLAYWRIGHT_CORE_JSON" ]; then
  echo "ERROR: playwright-core browsers.json not found at $PLAYWRIGHT_CORE_JSON" >&2
  exit 1
fi

CHROMIUM_REVISION="$(node -e "const j=require(process.argv[1]); const c=(j.browsers||[]).find(b=>b.name==='chromium'); if(!c?.revision){process.exit(1);} process.stdout.write(String(c.revision));" "$PLAYWRIGHT_CORE_JSON" || true)"

if [ -z "$CHROMIUM_REVISION" ]; then
  echo "ERROR: chromium revision not found in browsers.json" >&2
  exit 1
fi

mkdir -p /root/.cache/ms-playwright
ln -s /usr/lib/chromium "/root/.cache/ms-playwright/chromium-${CHROMIUM_REVISION}"
echo "Linked system chromium as revision chromium-${CHROMIUM_REVISION}"

