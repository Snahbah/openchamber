# Deployment Policy

## Source of truth

**The repo is the source of truth.** The running install
(`%APPDATA%/npm/node_modules/@openchamber/web`) is an `npm link` — a Junction
pointing at `packages/web` in this repo (branch `reconcile/2.3.1-port`). Edits to
the repo reach the running server on the next restart; there is no patch-library
copy step any more.

## Update procedure

1. **Edit the repo.** The linked install is the same directory — no copy.
2. **Restart.** `Stop-ScheduledTask -TaskName "dev.openchamber.web"` then
   `Start-ScheduledTask -TaskName "dev.openchamber.web"`, or run
   `~/.config/openchamber/bin/OpenChamber.ps1`. Verify a new PID on 3000.
3. **Verify.** `status.ps1`, and the marker test: a comment dropped into
   `session-goal/runtime.js` must appear through the junction, then vanish when
   removed.

## Verification

`C:\Users\Ross\.oio\bin\status.ps1` proves what is running. The link itself is
confirmed with `Get-Item <install>` → `LinkType: Junction`, `Target: <repo>/packages/web`.

## Rollback

- **Revert the npm link:** `npm unlink -g @openchamber/web` from `packages/web`,
  restore the install from `@openchamber/web.bak-pre-link-*`, restart.
- **Revert a file:** edit the repo — the linked install is the same file, so a
  revert is an ordinary `git checkout`.

## Known constraint

The scheduled task runs `S4U`/`Limited`. The detached `node.exe` holds a service
token and cannot be killed from a non-elevated shell; the launcher's pre-flight
block kills the stale process before starting a new one.
