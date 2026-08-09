---
id: google-apps-script
name: Google Apps Script
keywords: ["google apps script", "apps script", "gas", "google sheets", "spreadsheet", "google workspace", "gmail", "clasp", "google finance"]
---

# Google Apps Script Resource

Craft for Google Apps Script (GAS) projects. All sections sourced from official Google documentation.

## Core rules

1. Batch all spreadsheet reads and writes: use `Range.getValues()` / `Range.setValues()` once per block instead of per-cell calls, which are slow and burn execution time (source: https://developers.google.com/apps-script/guides/support/best-practices#use_batch_operations).
2. Wrap trigger handlers and any multi-step write in `LockService.getScriptLock()` and always release in a `finally` block to prevent concurrent executions corrupting state (source: https://developers.google.com/apps-script/reference/lock).
3. Store cross-execution state in `PropertiesService` as JSON strings; never in global variables, which reset on every execution (source: https://developers.google.com/apps-script/reference/properties).
4. Declare only the OAuth scopes the code actually uses in `appsscript.json`; excess scopes fail review and alarm users (source: https://developers.google.com/apps-script/concepts/scopes).
5. Every execution must finish within the 6-minute limit; long work must be chunked and resumable via time-driven triggers (source: https://developers.google.com/apps-script/guides/services/quotas).

## Testing patterns

1. Tests are plain `.gs` functions using GAS services only — no Jest, Mocha, or Node mocks.
2. Use scratch sheets (`SpreadsheetApp.getActive().insertSheet('SCRATCH_...')`) and delete them in a `finally` block; never mutate user data during tests.
3. Assert `MailApp.getRemainingDailyQuota() > 0` before any send test (source: https://developers.google.com/apps-script/reference/mail/mail-app#getRemainingDailyQuota).
4. Verify `ScriptApp.newTrigger()` calls guard against duplicate triggers before creating new ones (source: https://developers.google.com/apps-script/reference/script/script-app).
5. Execution and logs are verified manually in the Apps Script editor — provide numbered manual steps, never auto-run `clasp push` or `clasp deploy`.

## Tooling and limits

1. Deployment: `clasp login`, set the Script ID in `.clasp.json`, then `clasp push` (source: https://developers.google.com/apps-script/guides/clasp).
2. Quotas (consumer / Google Workspace): email 100 / 1,500 recipients per day; 6 min per execution; PropertiesService 9 KB per value, 500 KB total; 20 triggers per user per script (source: https://developers.google.com/apps-script/guides/services/quotas).
3. UrlFetch and GmailApp calls are quota-bound; cache `GOOGLEFINANCE` results in sheet cells instead of re-calling in loops.
4. The manifest `appsscript.json` controls scopes, timezone, and exception logging; keep it under version control.

## Common mistakes

1. Per-cell `getValue()` in loops — the top GAS performance trap; always batch.
2. Missing `releaseLock()` when an exception is thrown — deadlocks the next trigger run; use `finally`.
3. Real time-driven triggers created during tests — they keep firing after the test ends.
4. Secrets (API keys, emails of real users) hardcoded in `.gs` files or included in exports.
5. Assuming global variables persist between executions — they do not; use PropertiesService.

_Last updated: 2026-07-18_
