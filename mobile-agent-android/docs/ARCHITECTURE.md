# Architecture (Draft)

## Principles
1. Workspace Isolation: all new code under `mobile-agent-android/**`.
2. Human-in-the-loop: all write operations must pass Edit Gate.
3. Observable Agent: each round emits trace entries for replay/debug.
4. Provider-agnostic model routing with fallback.

## Planned modules
- app-android: UI + app lifecycle + local storage
- core/agent: state machine + loop runner
- core/editgate: snapshot/hash/diff/apply
- core/tools: tool interfaces/adapters
- core/modelrouter: ask/agent routes + fallback
- core/github: branch/commit/push/pr helpers

## P0 design
- See `docs/P0-CORE-DESIGN.md` for the unified state machine, failure recovery contract, and task package protocol.

