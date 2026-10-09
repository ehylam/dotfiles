# Shopify Section Modification

Follow this workflow when modifying a Shopify section. Do not skip steps.

## Input

The user will specify which section to modify and what changes to make. If the section name or file path is ambiguous, ask before proceeding.

## Workflow

1. **Read the section file** — Read the entire `.liquid` file. Understand the existing schema, Liquid logic, markup, CSS, and JS.

2. **Validate schema understanding** — Identify all schema settings, blocks, and presets. Note any metafield references or dynamic sources.

3. **Plan the change** — State what you will modify (schema settings, Liquid logic, markup, styles, scripts). List files affected. Get user confirmation if the scope is larger than expected.

4. **Implement Liquid/markup changes** — Edit the template portion. Ensure new settings are referenced correctly and conditional logic handles missing values.

5. **Implement CSS changes** — Edit section-scoped styles. Use existing custom properties and class naming conventions. No `!important` unless overriding third-party.

6. **Implement JS changes** — If applicable. Use `defer` or module pattern. Add `Shopify.designMode` checks for theme editor events.

7. **Update schema** — Add/modify settings, blocks, or presets. Ensure `type`, `id`, `label`, and `default` are correct.

8. **Validate JSON** — Re-read the file and confirm the `{% schema %}` JSON is valid. Check for trailing commas, mismatched brackets, and missing quotes.

9. **Self-review** — Check for:
   - CSS classes in markup that don't exist in styles (and vice versa)
   - Schema setting IDs referenced in Liquid that don't match
   - Missing `| escape` on user content
   - Missing translation keys for customer-facing strings
   - Hardcoded values that should be settings

10. **Present the change** — Summarise what was modified and any caveats (e.g., "test in theme editor to verify block reordering").
