---
name: pi-extension-lifecycle-events
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - lifecycle hook
  - session event
  - tool call event
  - agent event
  - user bash event
  - input event
  - compaction event
not-for-drivers:
  - tool only extension
  - no event needed
  - pure data extension
source: official-pi-spec
---

# Pi Extension — Lifecycle Events Spec

Pi emits a stream of events throughout each session. Extensions subscribe via `pi.on(eventName, handler)`. The event catalog below is the source of truth.

## Session lifecycle

| Event | When | Can return |
|---|---|---|
| `session_start` | Session started, loaded, or reloaded | — |
| `session_before_switch` | Before `/new` or `/resume` | `{ cancel: true }` |
| `session_before_fork` | Before `/fork` or `/clone` | `{ cancel: true }` |
| `session_shutdown` | Before extension runtime is torn down | — |
| `session_before_compact` | Before `/compact` or auto-compaction | `{ cancel: true }` or `{ compaction: {...} }` |
| `session_compact` | After compaction completes | — |
| `session_before_tree` | Before `/tree` navigation | `{ cancel: true }` or `{ summary: {...} }` |
| `session_tree` | After tree navigation | — |

`session_start` fires for `startup | reload | new | resume | fork`; `event.reason` distinguishes.

## Resource lifecycle

| Event | When | Can return |
|---|---|---|
| `resources_discover` | After `session_start` | `{ skillPaths, promptPaths, themePaths }` |

## Agent lifecycle

| Event | When | Can return |
|---|---|---|
| `before_agent_start` | After user submits prompt, before agent loop | `{ message, systemPrompt }` |
| `agent_start` | Once per user prompt | — |
| `agent_end` | Once per user prompt | — |
| `turn_start` | Each turn (one LLM response + tool calls) | — |
| `turn_end` | Each turn | — |
| `message_start` | User, assistant, toolResult message start | — |
| `message_update` | Assistant streaming updates | — |
| `message_end` | User, assistant, toolResult message end | — |
| `context` | Before each LLM call | `{ messages }` |
| `before_provider_request` | After provider payload built, before request | `{ payload }` or `undefined` |
| `after_provider_response` | After HTTP response, before stream consumed | — |
| `model_select` | Model changed via `/model` or session restore | — |

## Tool lifecycle

| Event | When | Can return |
|---|---|---|
| `tool_execution_start` | Tool call about to execute | — |
| `tool_call` | Before tool runs | `{ block: true, reason? }` |
| `tool_execution_update` | During tool execution | — |
| `tool_result` | After tool finishes, before result message | `{ content?, details?, isError? }` |
| `tool_execution_end` | Tool execution complete | — |

`tool_call.input` is mutable. Mutate in place to patch arguments before execution. Later handlers see earlier mutations. No re-validation after your mutation.

## User bash lifecycle

| Event | When | Can return |
|---|---|---|
| `user_bash` | User executes `!` or `!!` command | `{ operations }` or `{ result }` |

## Input lifecycle

| Event | When | Can return |
|---|---|---|
| `input` | User input received (before skill/template expansion) | `{ action: "continue" \| "transform" \| "handled", text? }` |

Processing order: extension commands → input event → skill commands → prompt templates → agent processing.

## Event handler rules

1. Multiple handlers run in extension load order.
2. `tool_call` handlers chain via `event.input` mutation; return values only control blocking.
3. `tool_result` handlers chain via patch returns; omitted fields keep current values.
4. Use `ctx.signal` inside async handlers for cancellation parity.
5. Use `isToolCallEventType` for typed tool inputs.

## Common pitfalls

- **Wrong event** — hooking `session_start` for something that fires on `before_agent_start`.
- **Returning from non-blocking event** — many events cannot return anything; returning causes silent drop.
- **Mutating `event.input` after return** — late mutations ignored.
- **No ctx.signal** — long handler can't be cancelled.
- **Blocking on sync I/O** — handler blocks the agent loop.