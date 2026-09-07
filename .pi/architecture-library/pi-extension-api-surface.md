---
name: pi-extension-api-surface
domain: pi-extension-spec
team-size: any
complexity: low
best-for-drivers:
  - extension api
  - register tool
  - register command
  - register provider
  - send user message
  - send message
  - append entry
not-for-drivers:
  - pure data extension
  - no runtime interaction
  - read only
source: official-pi-spec
---

# Pi Extension — ExtensionAPI Surface Spec

`ExtensionAPI` is the object passed to the extension factory function. It exposes the full surface for event subscription, resource registration, message injection, and runtime control.

## Event subscription

```typescript
pi.on(eventName: string, handler: Function): void
```

Subscribes to any lifecycle event listed in `pi-extension-lifecycle-events`.

## Tool registration

```typescript
pi.registerTool({
  name: string,
  label: string,
  description: string,
  promptSnippet?: string,
  promptGuidelines?: string[],
  parameters: TSchema,
  prepareArguments?: (args) => args,
  execute: async (toolCallId, params, signal, onUpdate, ctx) => Result,
  renderCall?: (args, theme, ctx) => rendered,
  renderResult?: (result, options, theme, ctx) => rendered,
}): void
```

`parameters` must be a TypeBox schema. The `execute` callback returns `{ content: [{ type: "text", text }], details, isError? }`.

## Command registration

```typescript
pi.registerCommand(name: string, {
  description: string,
  handler: async (args, ctx) => void,
  getArgumentCompletions?: (prefix) => AutocompleteItem[] | null,
}): void
```

Names conflict resolution: numeric suffix in load order (`/review:1`, `/review:2`).

## Resource registration

```typescript
pi.registerShortcut(shortcut: string, { description, handler }): void
pi.registerFlag(name: string, { description, type, default }): void
pi.registerProvider(name: string, config: ProviderConfig): void
pi.registerMessageRenderer(customType: string, renderer: Renderer): void
```

## Message injection

```typescript
pi.sendMessage(message: CustomMessage, options?: { triggerTurn?, deliverAs? }): void
pi.sendUserMessage(content: string | ContentBlock[], options?: { deliverAs? }): void
```

`deliverAs`:
- `"steer"` (default) — queued during streaming; delivered after current tool calls finish.
- `"followUp"` — waits for agent to finish all tools.
- `"nextTurn"` — queued for next user prompt; no interruption.

`triggerTurn: true` starts a new LLM turn immediately when agent is idle.

## State persistence

```typescript
pi.appendEntry(customType: string, data?: unknown): void
pi.setSessionName(name: string): void
pi.setLabel(entryId: string, label: string | undefined): void
```

`appendEntry` does NOT participate in LLM context. Use for extension state.

## Runtime control

```typescript
pi.exec(command: string, args: string[], options?: { signal?, timeout? }): Promise<{ stdout, stderr, code, killed }>
pi.reload(): Promise<void>
pi.setModel(model: Model): boolean
pi.getThinkingLevel(): "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
pi.setThinkingLevel(level): void
```

## Active tools

```typescript
pi.getActiveTools(): string[]
pi.getAllTools(): Array<{ name, description, parameters, sourceInfo }>
pi.setActiveTools(names: string[]): void
```

Works for both built-in and dynamically registered tools.

## Shared event bus

```typescript
pi.events.on(name: string, handler: Function): void
pi.events.emit(name: string, data: unknown): void
```

For inter-extension communication.

## Common pitfalls

- **Wrong event name** — typo silently fails.
- **Tool without TypeBox** — runtime validation skipped.
- **`sendUserMessage` without deliverAs during streaming** — throws.
- **`reload()` after await** — code after `await pi.reload()` runs in old version.
- **Tools calling `ctx.reload()`** — tools can't reload; use a command as the entrypoint.