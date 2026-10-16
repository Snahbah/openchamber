# Deployment Policy

## Source of truth (interim)

**The patch-library model.** Until Phase 7 (npm link) is completed, the running
install is stock `@openchamber/web@2.3.1` with local patches applied on top.
The repo (`feat/memory-consolidation` branch) holds the durable form of those
patches but is **not** deployed — it is four minor versions behind the install.
The repo will become the source of truth once the 2.1.0 → 2.3.1 reconciliation
is completed and `npm link` is established. That work is deferred pending a
deliberate, conflict-resolved rebase; see `deferred-phase7-rebase.md`.

## Update procedure

When upstream publishes a new version and `npm update @openchamber/web` runs:

1. **Stop the service.** `Stop-ScheduledTask -TaskName "dev.openchamber.web"`,
   then kill the stale process if it survives (`Get-NetTCPConnection -LocalPort 3000`).
2. **Check for patch loss.** Run `status.ps1`. If the install version changed,
   the patches are gone.
3. **Re-apply patches.** Use the backup-diff-copy procedure from the hardening
   directive: for each patched file, restore from the repo copy, back up the new
   install file, copy the repo file over, `node --check`.
4. **Restart.** Start the task; verify a new PID on 3000.
5. **Verify.** Run `status.ps1` again. Confirm `fallbacks_total` on `/health`
   and `200_000` in `session-goal/runtime.js`.

## Verification

`C:\Users\Ross\.oio\bin\status.ps1` is the single command that proves what is
running. Run it before and after every change. If reality and expectation
differ, stop and fix the map before proceeding.

## Rollback

- **Revert a patched file:** copy `<file>.bak-<timestamp>` over the current file;
  restart via the launcher.
- **Revert the launcher:** copy
  `C:\Users\Ross\.config\openchamber\bin\OpenChamber.ps1.bak-<timestamp>` over
  the current launcher; restart.
- **Revert the npm link (when Phase 7 lands):** `npm unlink -g @openchamber/web`
  from the repo's `packages/web`, restore the install from
  `@openchamber/web.bak-pre-link-*`, restart.

## Known constraint

The scheduled task runs `S4U`/`Limited`. The detached `node.exe` holds a service
token and **cannot be killed from a non-elevated shell**. This is why the
launcher carries a pre-flight block that kills the stale process before starting
a new one — the launcher runs under the same token and can therefore terminate
its own predecessor.
