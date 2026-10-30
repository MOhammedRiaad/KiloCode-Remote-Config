# Architecture

Owned by the **architect** agent.

- `overview.md`: components, data flow, directory layout (created in cycle 1)
- `ADR-NNNN-<slug>.md`: architecture decision records. `ADR-0001-tech-stack.md` fixes the
  stack and the install/lint/test/build commands that every agent and `scripts/ci.sh` follow.
- `contracts/`: interface contracts. This product has no HTTP API; the contract is the typed
  plugin interface in `contracts/plugin-interface.md`.

ADR template:

```markdown
# ADR-NNNN: <title>
- Status: accepted
- Date: YYYY-MM-DD
- Cycle / item: cycle-NNNN / <item-id>

## Context
## Decision
## Consequences
## Alternatives considered
```
