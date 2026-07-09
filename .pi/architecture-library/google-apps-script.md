---
name: google-apps-script
domain: spreadsheet, automation, google-workspace, web-app, add-on
team-size: small-to-medium
complexity: low-to-medium
best-for-drivers:
  - google sheets
  - google workspace
  - spreadsheet automation
  - rapid internal tool
  - no server provisioning
  - event-driven triggers
  - add-on
  - web app
not-for-drivers:
  - large scale
  - low latency api
  - complex backend
  - long running computation
  - polyglot stack
  - vendor independence
source: community
---

# Google Apps Script Architecture

A serverless JavaScript runtime tightly integrated with Google Workspace, commonly used to automate Google Sheets, build add-ons, and expose simple web apps.

## When to use

- The project lives inside Google Workspace (Sheets, Docs, Forms, Gmail).
- You need rapid automation without provisioning servers.
- The workload fits within Apps Script execution limits.
- Users already work in Google Sheets.
- Event-driven triggers (time-based, form-submit, sheet-edit) are sufficient.

## When not to use

- Large-scale or high-throughput systems.
- Low-latency APIs or heavy backends.
- Long-running computations beyond execution quotas.
- Polyglot technology stacks.
- Vendor independence is required.

## Core rules

1. Keep scripts small and focused; split reusable code into Apps Script libraries.
2. Use bound scripts only when the sheet is the primary UI; prefer standalone scripts for backend logic.
3. Talk to Sheets by ID rather than binding logic to a specific spreadsheet.
4. Batch reads and writes to stay within quota and speed limits.
5. Use triggers for event-driven workflows, but handle failures and retries.
6. Store configuration and logs in dedicated sheets or PropertiesService.
7. Respect execution time limits and daily quotas.
8. Use `doGet`/`doPost` for simple web apps or REST-like endpoints.
9. Separate presentation (add-on UI / web app) from business logic and data access.
10. Version control code with clasp or a similar tool; do not rely only on the online editor.

## Typical folder structure

```
src/
  client/            # Add-on or web app HTML/JS/CSS
  server/
    main.ts          # Entry points and triggers
    sheets-api.ts    # Spreadsheet access layer
    config.ts        # PropertiesService / config sheet
    lib/             # Shared helpers
  appsscript.json
```

## Common pitfalls

- **Spreadsheet as database** — works for small datasets but breaks at scale.
- **Quotas and timeouts** — long loops or large sheets hit execution limits.
- **Hardcoded spreadsheet IDs** — makes scripts fragile across environments.
- **No version control** — changes in the online editor are hard to track.
- **Synchronous UI calls** — `google.script.run` callbacks need careful error handling.

## Migration path

When an Apps Script project outgrows its limits:
- Move heavy processing to a standalone backend (Cloud Functions, Cloud Run, Node.js).
- Use Sheets API from the backend instead of running logic inside Apps Script.
- Keep Apps Script as a thin trigger or UI layer.
