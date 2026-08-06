# Releasing Markpad

This document is the maintainer-facing runbook for cutting a Markpad release with auto-update enabled. Auto-update is wired through [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/), which verifies signed update bundles using [minisign](https://jedisct1.github.io/minisign/).

## One-time setup (do once, before the first auto-update-capable release)

### 1. Generate the signing keypair

On your local machine, in the Markpad checkout:

```bash
npm run tauri signer generate -- -w ~/.tauri/markpad-updater.key
```

You'll be prompted for a password. **Pick a strong one and store it together with the private key in your password manager.** The command produces two files:

- `~/.tauri/markpad-updater.key`     — **PRIVATE**. Never commit. Never share. Back up to a password manager.
- `~/.tauri/markpad-updater.key.pub` — **PUBLIC**. Shared with developers; ends up shipped inside Markpad.

### 2. Add Secrets to `sftwrdotdev/Markpad`

In the GitHub repo settings → Secrets and variables → Actions → New repository secret:

| Name                                  | Value                                              |
|---------------------------------------|----------------------------------------------------|
| `TAURI_SIGNING_PRIVATE_KEY`           | full content of `~/.tauri/markpad-updater.key`     |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | the password you set in step 1                     |

The build workflow reads both at signing time on macOS, Windows, and Linux runners.

### 3. Send the public key content

Send the **single-line content** of `~/.tauri/markpad-updater.key.pub` (no comments, no header lines) to the developer who'll commit it to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. This already happened for the current keypair — the committed value is the live public key, not a placeholder — so steps 1–3 are kept as history for anyone who ever has to redo the setup. While the field held a placeholder, auto-update was inert: the app surfaced a clean error state instead of contacting the update server.

### 4. CRITICAL: the pubkey is permanent

Once a release ships with the pubkey embedded, **it cannot be rotated** without breaking auto-update for every existing user. Rotation means everyone re-installs Markpad manually. Treat the keypair as a long-lived release secret.

If you ever lose the private key:

- Existing users can still use Markpad, but they will not auto-update again.
- A new keypair has to be generated, embedded in a new release, and that release has to be installed manually by every user.
- Communicate this in release notes so users aren't blindsided.

### 5. CRITICAL: `alecdotdev/Markpad` must never exist again

The updater endpoint in `src-tauri/tauri.conf.json` points at **`sftwrdotdev/Markpad`**. (`scripts/releaseWorkflow.test.ts` holds that name and the endpoint together — if the repository ever moves again, this line moves with it.)

Markpad was transferred from `alecdotdev/Markpad` to `sftwrdotdev/Markpad`, and `alecdotdev` is still a live account — a transfer between two accounts, not a rename. Pointing the endpoint at the new location **only helps builds made from here on.** The endpoint is compiled into the binary, so every copy of Markpad up to and including v2.7.0 asks GitHub for:

```
https://github.com/alecdotdev/Markpad/releases/latest/download/latest.json
```

and reaches the current feed only because GitHub answers it with a 301 to the new location. Those installs will use that redirect for as long as they run, however many versions ship after this one.

GitHub voids a transfer redirect if the old location is occupied again. From [Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository):

> If you create a new repository or fork at the previous repository location, the redirects to the transferred repository will be permanently deleted.

So, permanently, and regardless of what it would contain:

- **Do not create a repository named `Markpad` under `alecdotdev`.**
- **Do not fork `sftwrdotdev/Markpad` to `alecdotdev`** — the doc says a fork at the old location voids the redirect just as a new repository does.
- **Do not transfer Markpad back to `alecdotdev`, then away again.** Each hop leaves another compiled-in endpoint depending on another redirect.

It is worth closing the obvious loophole in advance, because it is the reasonable-sounding one. The redirect is only the *means*; what those installs actually need is for that URL to keep returning a current `latest.json`. A repository at the old location could in principle keep them working — publish a release there whose `latest.json` names this repository's artifacts, and the pinned key still verifies it, because it is the same key. **Do not do this.** It trades a guarantee that costs nothing for an obligation that has to be met on every release, forever, by whoever is releasing at the time. The first time it is missed, old clients are handed a stale feed that offers them a version they already have, and they stop updating exactly as if the URL had 404'd — only now nothing is obviously broken for anyone to notice.

The failure this prevents is quiet. `latest.json` becomes a 404, the updater reports no update available, and users on old versions simply stop being offered new ones — with no error anyone but that user can see. There is no way to fix it from this repository afterwards; the only remedy is asking every affected user to reinstall by hand.

What this is *not* is a code-execution risk. The `pubkey` in `tauri.conf.json` is pinned, and `tauri-plugin-updater` verifies the minisign signature on the downloaded bundle before installing it. Whoever ends up serving that URL cannot ship a Markpad update that installs, because they cannot produce a signature for it. The exposure is broken or stalled updates, not a hijacked one.

## Per-release workflow

The workflow uses `npm ci`, so its installed dependency graph is exactly the committed lockfile. Do not replace it with `npm install` in release jobs. The same applies to [`snapcraft.yaml`](snapcraft.yaml), which builds the snap outside GitHub Actions; `scripts/releaseWorkflow.test.ts` guards both.

1. **Bump version in both files** (mandatory — Tauri reads runtime version from `Cargo.toml`):
   - [`package.json`](package.json) `version`
   - [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) `[package].version`
2. **Commit, tag, push:**
   ```bash
   git commit -am "chore: bump version to X.Y.Z"
   git tag vX.Y.Z
   git push origin master vX.Y.Z
   ```
3. **Trigger the workflow:**
   - GitHub UI: Actions → "Build and Release" → Run workflow → master
   - Or CLI: `gh workflow run build.yml --ref master`
4. **Wait** ~30 min for matrix builds to finish, plus ~2 min for `generate-update-feed`.
5. **Open the draft release** on the [Releases page](https://github.com/sftwrdotdev/Markpad/releases). Verify the assets:
   - **macOS**: `*.dmg`, `*.app.tar.gz`, `*.app.tar.gz.sig`
   - **Windows x64**: `Markpad_<version>_x64.exe` (portable), `*_x64-setup.exe` (NSIS installer), `*_x64-setup.exe.sig`
   - **Windows ARM64**: `Markpad_<version>_arm64.exe` (portable), `*_arm64-setup.exe` (NSIS installer), `*_arm64-setup.exe.sig`
   - **Linux**: `*.deb`, `*.rpm`, `*.AppImage`, `*.AppImage.sig`
   - **Update feed**: `latest.json` (one entry per successfully built platform)
6. **Click "Publish release"** — this is the gate that activates auto-update for all clients pointing at `releases/latest/download/latest.json`.

## First auto-update-capable release

The first release after auto-update is enabled does **not** auto-update existing users — older Markpad builds don't have the updater wiring yet. They must download and install this version manually once. From then on, every subsequent release reaches users automatically.

Mention this clearly in the release notes for the first auto-update-capable version, e.g.:

> This release activates in-app auto-updates. **Install it manually one last time** — future releases will update Markpad on their own.

## Coverage notes

- **macOS** uses one universal binary (`darwin-aarch64` + `darwin-x86_64` share the same `.app.tar.gz` and signature).
- **Windows** uses NSIS — the auto-updater downloads `*-setup.exe` (verified by `*-setup.exe.sig`) and runs it in `passive` install mode. The existing raw portable `.exe` distribution path is preserved alongside, so users who download the portable `.exe` directly continue to work; only the auto-updater path uses the NSIS installer.
- **Linux**: only `AppImage` users get auto-updates — `tauri-plugin-updater` doesn't support `.deb` or `.rpm`. `apt`/`rpm` users keep getting updates via their distro package manager (or by downloading a fresh package).
- **Snap / Chocolatey**: independent distribution channels. Their update mechanisms are unaffected.

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|---------------------|
| Build fails: "missing `TAURI_SIGNING_PRIVATE_KEY`" | Step 2 of one-time setup wasn't done, or Secret name doesn't match. |
| `generate-update-feed` succeeds but `latest.json` lacks a platform | That platform's matrix build failed silently (or the `.sig` file wasn't produced). Check the failed build's logs. |
| `latest.json` missing entirely | The `generate-update-feed` job didn't run — usually because no `*.sig` files were uploaded. Check the `Upload * Artifacts` steps. |
| Users don't see the update | (1) Did you click *Publish release*? Drafts aren't visible to clients. (2) Is the user on a version older than the first auto-update-capable release? They need a one-time manual reinstall. |
| Update download succeeds but install fails with signature error | Pubkey mismatch — the Secrets and `tauri.conf.json` `pubkey` belong to different keypairs. |

## Out of scope (not handled by this workflow)

- **Apple Developer ID code-signing & notarization** — `.app` bundles are unsigned. macOS may show a Gatekeeper warning on first launch. Minisign verification by the updater is independent of Apple code-signing.
- **Windows Authenticode signing** — neither the portable `.exe` nor the `*-setup.exe` NSIS installer is signed with a code-signing certificate. Users may see a SmartScreen warning. Minisign verification by the updater is independent.
- **Retroactive signing** of older releases.
