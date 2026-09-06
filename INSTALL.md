# Installing Pi Senai

Pi Senai is a stage-gated orchestration extension for the [Pi coding agent](https://pi.dev). Once installed, it adds seven slash commands (`/senai-plan`, `/senai-implement`, `/senai-document`, `/senai-deliver`, `/senai-brainstorm`, `/senai-brainstorm-approve`, `/senai-doctor`, plus the config helpers) that walk software work through Plan → Implement → Document → Deliver.

This guide covers every install path and the most common follow-up tasks (verify, upgrade, uninstall, troubleshoot, develop).

---

## 1. Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| Pi coding agent | `0.84.3` | Latest stable |
| Node.js | `18.x` | `20.x` or `22.x` (matches Pi's runtime) |
| npm | `9.x` | bundled with Node 20 |
| OS | Linux, macOS, or Windows (WSL2) | Linux or macOS |

Check your versions:

```bash
pi --version
node --version
npm --version
```

If `pi` is not installed, follow https://pi.dev to install it first. Pi Senai does not work without Pi.

---

## 2. Install Pi Senai

Pick **one** of the three paths below. All three install the same package; only the scope differs.

### 2.1 — Global install (recommended for solo users)

Installs to `~/.pi/agent/settings.json`. Available in every directory you open with Pi.

```bash
pi install npm:@adi-mudi/pi-senai
```

Verify:

```bash
pi list | grep pi-senai
# Expected: npm:@adi-mudi/pi-senai
```

### 2.2 — Project-local install (recommended for teams)

Installs to `.pi/settings.json` inside the current project. The team shares the same version automatically (Pi auto-installs missing packages on startup).

```bash
cd /path/to/your/project
pi install -l npm:@adi-mudi/pi-senai
```

Then commit `.pi/settings.json` so your teammates pick it up:

```bash
git add .pi/settings.json
git commit -m "chore: add pi-senai to project settings"
```

### 2.3 — Development install (local clone)

Useful when you are hacking on Pi Senai itself or testing unreleased changes.

```bash
# Clone first:
git clone https://github.com/Adi-Mudi/pi-senai.git
cd pi-senai

# Install dependencies and build:
npm install
npm run build

# Then either:
pi install /absolute/path/to/pi-senai   # use the absolute path
# OR:
pi install ./                           # if you're inside the repo directory
```

Pi treats this as a reference — edits in the repo take effect on the next Pi restart.

---

## 3. Verify the Install

After any of the three paths above, confirm Pi Senai loaded and registered its commands.

```bash
# 1. List installed packages
pi list | grep pi-senai

# 2. List Pi Senai's slash commands
pi -p "Show all available /senai slash commands"
```

Expected output (every install path produces this):

```
1. /senai-brainstorm            — Refine the mission with the user before planning.
2. /senai-plan                  — Plan stage: research, interview, plan, review.
3. /senai-implement             — Implement stage: build and test the approved plan.
4. /senai-document              — Document stage: write project documentation.
5. /senai-deliver               — Deliver stage: security audit and final package.
6. /senai-doctor                — Full setup audit.
7. /senai-configure-*           — Configure agents / files / agent-files / architect-inputs.
8. /senai-generate-*            — Generate architecture / sub-agents / docs-structure.
```

If you see those, the install is good. If not, see [§7 Troubleshooting](#7-troubleshooting).

---

## 4. First-Time Setup (Project-Local Only)

After installing, run these once per project. They create `.pi/senai/*.json` config files and the sub-agent team.

```bash
cd /path/to/your/project

# 1. Tell Senai which paths / docs / tests are yours
/senai-configure-files

# 2. Map each Senai role to a sub-agent
/senai-configure-agents

# 3. (Optional) Pre-pick which documents each role reads
/senai-configure-agents-files

# 4. Generate architecture-aware agents + skills (one-time)
/senai-generate-architect
/senai-generate-sub-agents

# 5. Audit the setup
/senai-doctor
```

`/senai-doctor` reports what is missing. Once it shows zero errors, you can start a run with `/senai-brainstorm "<topic>"` or `/senai-plan "<mission>"`.

If you skip steps 1–4, Pi Senai will prompt you inline when the missing config is first needed.

---

## 5. Upgrade

To update to the latest published version:

```bash
pi update npm:@adi-mudi/pi-senai
```

To pin a specific version (recommended in CI):

```bash
pi install npm:@adi-mudi/pi-senai@0.2.5
```

Check which version you have installed:

```bash
pi list | grep pi-senai
# Example output: npm:@adi-mudi/pi-senai    /home/you/.pi/agent/npm/node_modules/@adi-mudi/pi-senai
cat ~/.pi/agent/npm/node_modules/@adi-mudi/pi-senai/package.json | grep '"version"'
```

---

## 6. Uninstall

### 6.1 — Global

```bash
pi remove npm:@adi-mudi/pi-senai
```

This removes the entry from `~/.pi/agent/settings.json`. **It does not delete files under `.IDE_Plans/pi-senai/`** — your run history stays intact if you reinstall later.

To also delete run history:

```bash
rm -rf .IDE_Plans/pi-senai/      # per-project run state
rm -rf ~/.pi/senai/              # global Senai cache (if it exists)
```

### 6.2 — Project-local

```bash
cd /path/to/your/project
pi remove -l npm:@adi-mudi/pi-senai
git add .pi/settings.json
git commit -m "chore: remove pi-senai from project settings"
```

### 6.3 — Development (local clone)

```bash
pi remove /absolute/path/to/pi-senai
```

The clone directory is untouched; you can keep working on it or `rm -rf` it.

---

## 7. Troubleshooting

### 7.1 — `pi install npm:@adi-mudi/pi-senai` fails with "command not found"

Pi is not on `PATH`. Install it first per https://pi.dev, then retry.

### 7.2 — `pi install npm:@adi-mudi/pi-senai` fails with "no such package"

Your npm registry might be private. Check:

```bash
npm config get registry
# Expected: https://registry.npmjs.org/
```

If it's a private registry (e.g., `https://npm.mycompany.com/`), set `npm-public-registry=https://registry.npmjs.org/` for the install:
```bash
pi install npm:@adi-mudi/pi-senai --registry=https://registry.npmjs.org/
```

### 7.3 — `/senai-brainstorm` returns "command not found" after install

Pi hasn't picked up the new package. Restart Pi, or run:

```bash
pi list                 # confirm pi-senai is listed
pi -p "Reload extension npm:@adi-mudi/pi-senai"
```

If still not found, remove and reinstall:

```bash
pi remove npm:@adi-mudi/pi-senai
pi install npm:@adi-mudi/pi-senai
```

### 7.4 — `/senai-doctor` reports missing config files

This is expected on a fresh project. Run the first-time setup (see [§4](#4-first-time-setup-project-local-only)) to create `.pi/senai/agents.json`, `files.json`, `agents_files.json`.

### 7.5 — Audit warnings about vulnerabilities

`npm audit` after install may flag Pi core packages (`@mariozechner/pi-*`) listed as Pi Senai's `peerDependencies`. These are NOT in Pi Senai's code. They clear when the Pi team releases patched versions. Safe to ignore.

### 7.6 — Slow first run / Pi Senai hangs during scout burst

The Plan stage bursts 4 scouts in parallel. If your provider hits a 429 rate limit, Pi Senai auto-demotes to staggered/serial spawn (see `/senai-cadence-status`). The plan finishes, just slower.

### 7.7 — Permission errors on Windows

Pi Senai uses POSIX file locks (`mkdir`-based). On Windows, enable [Developer Mode](https://learn.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development) so Pi can create symlinks.

---

## 8. Install Paths — Side-by-Side

| Path | Command | Stored in | Auto-installs for team? | Survives uninstall? |
|---|---|---|---|---|
| Global | `pi install npm:@adi-mudi/pi-senai` | `~/.pi/agent/settings.json` | No (per-user) | Run artifacts stay in `.IDE_Plans/` |
| Project-local | `pi install -l npm:@adi-mudi/pi-senai` | `.pi/settings.json` | **Yes** (commit it) | Run artifacts stay in `.IDE_Plans/` |
| Development | `pi install /path/to/pi-senai` | `~/.pi/agent/settings.json` (as path ref) | No | Source tree untouched |

---

## 9. Uninstall + Reinstall — Full Reset

If something is broken beyond recovery and you want a clean slate:

```bash
pi remove npm:@adi-mudi/pi-senai -l    # remove project-local
pi remove npm:@adi-mudi/pi-senai        # remove global
rm -rf .IDE_Plans/pi-senai/   # delete run history
rm -rf .pi/senai/             # delete doctor / config cache
pi install npm:@adi-mudi/pi-senai       # fresh install
```

Your project source files are never touched by Pi Senai.

---

## 10. Maintainer Notes (Publishing a New Version)

These steps are for the project maintainer, not for end users.

### One-time setup (already done for `Adi-Mudi/pi-senai`)

1. Create a Granular npm Access Token at https://www.npmjs.com/settings/adi-mudi/tokens:
   - Permissions: **Read and write**
   - Packages: **All packages** (or scope to `pi-senai`)
   - Organizations: **No access**
   - ☑️ **Bypass two-factor authentication (2FA)** ← critical
   - Expiration: 7 days (or longer)
2. Save to `~/.npmrc`:
   ```bash
   echo '//registry.npmjs.org/:_authToken=npm_XXXXXXXXXXXXXXXXXXXX' >> ~/.npmrc
   ```

### Per-release

```bash
cd /path/to/pi-senai

# 1. Make your changes, then:
npm run build
npm test

# 2. Commit and tag
git add -A
git commit -m "feat: <describe change>"
git tag v0.2.0
git push origin main --no-verify
git push origin v0.2.0

# 3. Bump version in package.json + create a matching git tag
npm version patch   # or minor / major

# 4. Publish (uses token from ~/.npmrc)
npm publish --access public

# 5. Users upgrade with:
#    pi update npm:@adi-mudi/pi-senai
```

### Optional: GitHub Actions auto-publish

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm test
      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Add `NPM_TOKEN` as a GitHub Actions secret. Then every `git tag vX.Y.Z && git push origin vX.Y.Z` publishes automatically.

---

## 11. Uninstall Pi Senai + Pi (Nuclear)

```bash
# Remove Pi Senai
pi remove npm:@adi-mudi/pi-senai
rm -rf .IDE_Plans/pi-senai/

# Remove Pi itself (macOS / Linux via npm)
npm uninstall -g @mariozechner/pi-coding-agent
```

---

## Quick Reference Card

```bash
# Install
pi install npm:@adi-mudi/pi-senai

# Upgrade
pi update npm:@adi-mudi/pi-senai

# Uninstall
pi remove npm:@adi-mudi/pi-senai

# Verify
pi list | grep pi-senai
pi -p "Show all /senai slash commands"

# Audit (project-local)
cd /path/to/your/project
/senai-doctor
```

That's it. You're set.
