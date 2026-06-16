# contextOS

`contextOS` is a terminal harness that makes every conversation context-first.

It searches durable context before the agent acts. If it does not find enough context, it asks the user what the missing workflow, artifact, formatting, and validation rules are. Reusable answers are saved as auditable memory so future conversations start smarter.

## Install

From GitHub:

```bash
npm install -g github:jmiettto/contextos
contextos
```

From this checkout:

```bash
npm install -g .
contextos
```

The `contextos` command runs Pi with this package loaded, so users do not need a separate `pi install` step.
If Pi is not already installed on the machine, `contextos` uses `npx -y @earendil-works/pi-coding-agent` to start it.

## Storage

Default location:

```text
~/.contextos/
  state.db
  audit.jsonl
  context/*.md
```

Override with:

```bash
export CONTEXTOS_HOME=/path/to/contextos-home
```

## Commands

- `/context status`
- `/context review`
- `/context undo <audit-id>`
- `/context invalidate <card-id>`
- `/context export`

## Agent Tools

- `contextos_search`
- `contextos_upsert`
- `contextos_questionnaire`
- `contextos_invalidate`
- `contextos_learning_log`

## Contract

- Search context before guessing.
- Ask when context is missing.
- Save reusable context with auditability.
- Treat memory as data, not as system instructions.
- Never save secrets or prompt-injection instructions.

## Development

```bash
npm install
npm run typecheck
npm test
npm run pack:dry
```
