# CONVENTIONS

Standards locked for this repo. These describe how the code already works at its best; follow them so the codebase keeps reading like one author. See `GLOSSARY.md` for canonical domain terms.

## Naming

- Types / classes: `PascalCase`, with the `Pip` / `PipPip` prefix for game entities (`PipPipGame`, `PipPlayer`, `PipShip`).
- Functions / variables: `lowerCamelCase`.
- Module-level constants: `SCREAMING_SNAKE_CASE`.
- Booleans read as questions: `isHost`, `hasRicochet`, `canSpawn`, `shouldRespawn`.
- Setters that mutate state and emit are `set<Thing>(value)` and emit a matching event.
- No abbreviation soup: prefer a concrete domain noun over `data`, `obj`, `val`, `temp`, `manager`, `handler`. Single letters only for tight loop counters and coordinates.
- Spelling counts: `DIAMETER` not `DAIMETER`, `parameter` not `parmeter`.

## Existence and null checks

- Use `typeof x === "undefined"` / `!== "undefined"` as the dominant idiom (not `== null`, not bare truthiness). Use `=== null` / `??` only for genuinely nullable references.

## Error handling

- The house rule is **sentinel-return over throw** at any IO or parse boundary. Do not throw across a network, storage, or `JSON.parse` boundary; return a safe default and `console.warn`.
- Layering: `game` is pure and never throws (it defends by clamping / normalizing values); `client` returns sentinels and never throws; `core` networking catches at the outer message loop and warns; `server` uses `try/catch` only where it talks to the outside (telegram).
- Logging channel is `console.warn` (there is no logger abstraction). Prefix subsystem warnings, e.g. `[telegram]`.

## Formatting

- Brace / control-flow spacing: tight form, `if(x){ ... } else{ ... }`. Enforced by eslint, not by hand.
- 4-space indent, no semicolons, double quotes.
- Resolve the brace split by autofix; do not hand-edit unrelated lines.

## Shared logic placement

- Logic that runs on BOTH client and server (validation, clamping, wire shaping, scoring) lives in `@pip-pip/game`. Do not reimplement it per side; import it.
- Generic primitives (scalar `clamp`, bounds accumulation, guarded `localStorage`) live in `@pip-pip/core`.
- Cross-package imports use the full `@pip-pip/<pkg>/src/<path>` form (never relative `../` across the package, never a bare import), or `fix-tsc-paths` will not rewrite them.

## Project-specific rules (non-negotiable)

- **Player names:** one shared cleaner in `@pip-pip/game`. Policy is alphanumeric-only: strip to `[0-9a-z_]`, cap at 16. Both client and server call the same function.
- **Match-config bounds:** one authoritative bound per field, applied at every ingress (lobby seed, packet, command). `maxKills` is `[5, 50]`, `matchMinutes` is `[1, 10]`, sourced from shared `MODE_*` constants in `@pip-pip/game`.
- **Authority gating:** every authoritative game decision is gated behind an `options.<flag>` check so the same `PipPipGame` runs correctly on both sides.
- **Wire enums:** map values with named `X_TYPE_TO_CODE` / `X_CODE_TO_TYPE` tables (mirroring the buff wire enum), never nested ternaries or bare integer literals.
- **Client TypeScript:** the client builds with an older `tsc` (4.8.4) than your local toolchain. Gate client changes with the client's own `tsc` (`yarn client build` or the client tsconfig) before assuming a deploy will pass.
- **Copy / comments / commits:** no em-dashes anywhere. Comments document the WHY (decision, tradeoff, gotcha), never restate WHAT the code already says.

## File size and structure

- Keep source files focused on one responsibility. A file over 300 lines must either be split along a pure seam, or carry a one-line header comment explaining why it stays whole (e.g. a single cohesive state machine or a single-source wire contract).

## Tests

- A unit that is extracted or split out during a refactor ships with a test, or a visible `TODO(test): ...` marker if coverage is explicitly deferred.
- Run `yarn test` (vitest, suite under `tests/`) before claiming tests pass. Run `yarn clear` before `yarn lint` (stale `dist/*.d.ts` otherwise produces false errors).
