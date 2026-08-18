# ruah-conv — Deep Build Plan (continuous track)

> Read first: `../GROK_BUILD_PLAN.md` §C, `../ENGINEERING_STANDARDS.md`.
> Package: `@ruah-dev/conv` · CLI: `ruah conv …` · Track: **continuous, parallel to T1–T5**

## 1. Where the code is today (verified 2026-08-18)

Mature and published: root 14/14 + core suite (175+) green. IR-based pipeline in
`packages/core`: parsers (OpenAPI 3.x, Swagger 2.0, Postman v2.1, GraphQL SDL,
HAR) → canonical Ruah Tool Schema IR → generators (MCP defs, MCP servers TS/Py,
OpenAI/Anthropic function-calling, plugin bundles). Has git.

**Housekeeping found during workspace audit:** `package.json` has NO
`"ruah": { "namespace": "conv" }` field — `ruah conv …` currently resolves only
through ruah-cli's fallback registry. Add the field (first, trivial commit).

## 2. Mission shift: curation, not conversion

Spec→MCP converters are commodity. The differentiated story: a 400-endpoint spec
is *hostile* to an agent (definition bloat, choice paralysis); collapse it into
5–10 task-shaped tools with compact schemas. Conversion is the engine; curation is
the product.

## 3. Work plan (any order, keep shipping)

### C1 — namespace field + demo greenkeeping
Add the `ruah` field. Keep the 30-second demo working at all times:
`npx @ruah-dev/conv openapi <spec> → serving MCP server`. Add a CI smoke test that
runs the README's exact quickstart commands (standards §7 — examples can't rot).

### C2 — context-cost report (bridges to ruah-opt's story)
Every generation prints (and includes in `--json`): number of tools, estimated
token footprint of the definitions (estimator copied from opt, `sync-with`), and
the three heaviest tools. One line: `"this surface costs ~14.2k tokens of
definitions"`. Threshold warning above a configurable budget. Token-costing
strings is cheap; the *insight* is the feature.

### C3 — `ruah conv curate` (the headline)
`ruah conv curate <spec> [--interactive] [--out curated/]`
1. **Rank**: score endpoints via deterministic heuristics — reachability from
   common nouns (CRUD verbs on top-level resources), parameter complexity,
   deprecation flags, tag frequency; document each heuristic honestly in README.
2. **Group**: cluster endpoint families (`/users`, `/users/{id}`, sub-resources)
   into candidate task-tools (`manage_users`) whose input schema is a
   discriminated union of operations (`{"action": "get" | "list" | …}`).
3. **Propose**: emit a `curation.json` plan — kept tools, collapsed groups,
   dropped endpoints with reasons. `--interactive` walks the proposal for
   accept/edit/drop per group; non-interactive applies defaults.
4. **Generate**: existing generators consume the curated IR (curation is an
   IR→IR transform — do NOT fork the generators; if generators need hooks,
   that's a small core change with its own tests).
5. `curation.json` is committed by users and replayed: `ruah conv curate <spec>
   --plan curation.json` → deterministic regeneration on spec updates, with a
   drift report (new/removed endpoints since the plan).
Non-goal: LLM-assisted curation. Heuristics + human-in-the-loop only, this phase.

### C4 — presets & deferred loading
`--preset minimal|standard|full` bundling curation defaults + description
truncation policy. For surfaces that stay large: generate the search-then-load
pattern — a `search_tools` meta-tool + on-demand schema loading — as an MCP
server option (`--deferred`), with README guidance on when it's worth it.

## 4. Testing plan (additions to a healthy suite)

- Curation golden tests: fixture specs (a real-shaped 300+ endpoint OpenAPI file,
  a small GraphQL SDL) → `curation.json` byte-stable; grouping unit tests
  (path-family clustering; edge: versioned paths `/v1/`, `/v2/` don't merge).
- Union-tool schema correctness: generated `manage_users` schema validates
  sample calls for each action; invalid action rejected.
- Replay + drift: mutate the fixture spec (add/remove endpoint) → drift report
  exact.
- Context-cost: hand-computed token estimate on a tiny fixture within tolerance;
  `--json` contract fields stable.
- MCP handshake test vs a reference client fixture stays green for curated and
  deferred variants.
- Hostile specs: circular `$ref`s, 10MB spec (time-bounded), unicode operationIds,
  duplicate operationIds (→ UserError naming them).

## 5. Acceptance criteria

- Curated Stripe-scale fixture → ≤ 10 tools, footprint reported, generated server
  passes the MCP handshake fixture.
- `curate --plan` replay is deterministic; drift report correct after spec bump.
- `ruah conv …` works via the CLI (namespace field present).
- Existing 175+ tests stay green throughout — curation must not destabilize
  conversion. Verify green on every commit.

## 6. Demo asset (required — `files/demos/conv/`)

30s GIF: `npx @ruah-dev/conv curate stripe.yaml` → "400 endpoints → 8 tools,
~6k tokens of definitions (was ~92k)" → server starts → agent lists 8 tools.
The before/after token number IS the tweet.

## 7. Don'ts

- Don't fork generators for curation — IR-to-IR transform only.
- Don't let heuristics pretend to be smarter than they are; every drop has a
  stated reason a human can veto.
- Don't break the plain conversion path — commodity or not, it's the on-ramp.
