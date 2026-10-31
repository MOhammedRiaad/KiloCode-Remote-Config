# Architecture

Owned by the **architect** agent.

- `overview.md`: components, data flow, directory layout (created in cycle 1)
- `ADR-NNNN-<slug>.md`: architecture decision records. `ADR-0001-tech-stack.md` fixes the
  stack and the install/lint/test/build commands that every agent and `scripts/ci.sh` follow.
- `contracts/`: interface contracts. This product has no HTTP API. The contracts are the typed
  plugin interface in `contracts/plugin-interface.md` and the shared config validator CLI in
  `contracts/validator-cli.md` (since F-007) and the personal config template in
  `contracts/personal-config-template.md` (since F-009) and the bootstrap installer in
  `contracts/installer-cli.md` (since F-010; `install.ps1` since F-011, section 10) and the shared
  config repo template, assemble tool, PR pipeline and branch-policy script in
  `contracts/shared-config-repo.md` (since F-008).

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
