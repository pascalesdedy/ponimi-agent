import test from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedPlaywrightCode } from "../security/codeSafety";

test("code safety blocks dangerous modules and calls", () => {
  const unsafe = `
    import { test } from '@playwright/test';
    import { exec } from 'child_process';
    test('x', async () => { exec('whoami'); });
  `;
  const result = validateGeneratedPlaywrightCode(unsafe);
  assert.equal(result.safe, false);
  assert.ok(result.reasons.length > 0);
});

test("code safety allows basic playwright test", () => {
  const safe = `
    import { test, expect } from '@playwright/test';
    test('ok', async ({ page }) => {
      await page.goto('https://example.com');
      await expect(page).toHaveTitle(/Example/);
    });
  `;
  const result = validateGeneratedPlaywrightCode(safe);
  assert.equal(result.safe, true);
});

