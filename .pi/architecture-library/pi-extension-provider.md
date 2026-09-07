---
name: pi-extension-provider
domain: pi-extension
team-size: any
complexity: medium
best-for-drivers:
  - custom llm provider
  - proxy endpoint
  - oauth flow
  - corporate ai gateway
  - local model server
  - model discovery
  - api key rotation
not-for-drivers:
  - default providers sufficient
  - pure tool extension
  - no model interaction
  - single user key
source: official-pi-pattern
---

# Pi Extension — Provider

A Pi extension that registers one or more model providers via `pi.registerProvider()`. Useful for proxies, custom endpoints, and OAuth flows.

## When to use

- The team proxies through a corporate AI gateway.
- A local model server (llama.cpp, vLLM, ollama) needs integration.
- OAuth flows replace static API keys.
- Model discovery happens at runtime from a remote endpoint.

## When not to use

- Default Pi providers are sufficient.
- The extension has nothing to do with model selection.
- Provider credentials are static and per-user.

## Core rules

1. Register providers inside an `async` factory function when discovery is needed at startup.
2. Specify `baseUrl`, `apiKey` (env var name), and `api` (`anthropic-messages`, `openai-completions`, etc.).
3. Provide complete `models[]` with `id`, `name`, `contextWindow`, `maxTokens`, `cost`, `reasoning`, `input`.
4. Use `oauth` config when the provider supports `/login`.
5. Test provider registration with an async factory; do not defer to `session_start`.
6. Provide a command to list models (`/myprovider-models`).
7. Document the env var names required by the provider.

## Typical structure

```
src/
├── index.ts              # async factory, registers provider
├── models.ts             # model definitions
├── oauth.ts              # oauth login flow
├── discovery.ts          # remote model discovery
└── commands/
    └── list-models.ts
```

## Common pitfalls

- **Missing models[]** — provider registered without models, none selectable.
- **Env var typo** — `apiKey: "MY_KEY"` vs `apiKey: "MY_API_KEY"` silently fails.
- **No async factory** — discovery deferred to `session_start`, race with other extensions.
- **OAuth callback missing** — login flow never resolves.
- **Hard-coded secrets** — apiKey literal instead of env var name.