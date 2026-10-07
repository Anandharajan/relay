## What and why

<!-- What does this change, and which problem does it solve? Link the issue: Closes #123 -->

## How I tested it

<!-- Commands run, screenshots for UI changes, languages tried in the widget. -->

## Checklist

- [ ] `pnpm typecheck && pnpm test` pass
- [ ] Tests added or updated for behaviour changes
- [ ] New queries are scoped by `org_id`; no raw PII is sent to an LLM
- [ ] Schema changes are in a new migration file
- [ ] Docs or `.env.example` updated if config changed
