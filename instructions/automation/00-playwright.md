# Playwright Automation Guidelines

## Locator Strategy (priority order)
1. getByRole + name — always first
2. getByLabel — for form fields
3. getByTestId — if available
4. getByText — for dynamic content
5. locator(css) — last resort

## Best Practices
- Use page object model for reusable components
- Add proper waitFor before assertions on async content
- Use soft assertions (expect.soft) for non-critical checks
- Set reasonable timeouts (30s default, 60s for complex flows)
- Handle loading spinners explicitly
