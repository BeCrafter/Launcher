# Installing BeCrafter Launcher

Four routes, pick one. **The first three are the recommended ones** — none of them tags the artifact with the
`com.apple.quarantine` flag, so it just works after install (why that matters: see "Why does it say damaged" at the end).

| Channel | One command | Best for | Versions available |
|---|---|---|---|
| **A. curl script** | `curl -fsSL https://repo.iskill.site/launcher/install.sh \| bash` | One command, no package manager needed on the machine | **Any version** (including older ones and pre-releases) |
| **B. Homebrew** | `brew install --cask becrafter/brew/launcher` | Already managing everything with Homebrew | Latest stable only |
| **C. npm** | `npx -y @becrafter/launcher` | Node available, comfortable with npx | This CLI's version line, or `--version` to pin |
| **D. Manual** | Download the zip yourself and drag it into Applications | Restricted network, or you want an offline copy | Any (see the caveats below) |

## Common requirements

- **macOS 12.0 (Monterey) or newer**; separate artifacts for Apple Silicon (arm64) and Intel (x64)
- Download is about **120MB**, installed size about **260MB**
- Installs to `/Applications` by default; falls back to `~/Applications` when that isn't writable (both paths are recognised by the app)
- The app is **ad-hoc signed and not notarized** (this project doesn't buy an Apple developer certificate). That doesn't
  affect usage, but it does mean "you can't go the browser-download route" — see troubleshooting at the end

---

## Channel A: curl script (recommended)

```bash
curl -fsSL https://repo.iskill.site/launcher/install.sh | bash
```

> The script is hosted on R2 (same domain as the artifacts and the version manifest) at
> `https://repo.iskill.site/launcher/install.sh`; changes to `scripts/install.sh` are synced there by CI on push to main.
> If the CDN is unreachable, there's a fallback entry point at
> `https://raw.githubusercontent.com/BeCrafter/Launcher/main/scripts/install.sh` (identical content).

It will: read the version manifest from the CDN → pick the architecture via `uname -m` → download
`Launcher-latest-<arch>.zip` → **extract with `ditto -x -k`** (`unzip` drops symlinks and extended attributes,
which breaks the `.app` signature) → place it in `/Applications` (or `~/Applications` if not writable) →
clear the quarantine flag once (defensively) → verify `Contents/MacOS/Launcher` exists →
print the installed version.

### Options

```bash
# Install a specific version
curl -fsSL .../install.sh | bash -s -- --version 0.1.4

# See which versions are available (stable only by default; --pre includes pre-releases)
curl -fsSL .../install.sh | bash -s -- --list --pre

# Version check: what's installed here vs. what the repository has
curl -fsSL .../install.sh | bash -s -- --check

# Install elsewhere
curl -fsSL .../install.sh | bash -s -- --dir ~/Applications
```

| Option | Description |
|---|---|
| `--version <x.y.z>` | Install a specific version; omitted, it takes whatever the CDN's `latest` alias points at |
| `--dir <path>` | Install directory; defaults to `/Applications`, falls back to `~/Applications` |
| `--list` | List available versions (`--pre` includes pre-releases) |
| `--check` | Installed version vs. newest in the repository |
| `-h, --help` | Help |

| Environment variable | Description |
|---|---|
| `LAUNCHER_R2_BASE` | Replace the download root (mirror / self-hosted CDN); the version manifest lives under the same root, so a mirror only needs to mirror this directory |
| `LAUNCHER_INSTALL_DIR` | Same as `--dir` |

### Upgrade and uninstall (Channel A)

```bash
# Upgrade = run the installer again (it reports the current version first)
curl -fsSL .../install.sh | bash

# Uninstall
rm -rf /Applications/Launcher.app          # use the ~/Applications path if that's where it went
rm -f ~/.local/bin/launcher-mcp            # if you ever clicked "Install to PATH" in the app
```

---

## Channel B: Homebrew

```bash
brew install --cask becrafter/brew/launcher
```

**Use the fully qualified name `becrafter/brew/launcher`**: a bare cask name resolves across all taps, so if any tap
ever defines a cask with the same name, `brew install --cask launcher` becomes ambiguous.

The cask does two things automatically after install (`postflight`):

1. `xattr -dr com.apple.quarantine` — Homebrew **actively** tags cask downloads with the quarantine flag
   (`--no-quarantine` was removed in Homebrew 7), and without clearing it macOS declares the app "damaged"
2. `chmod +x Contents/Resources/launcher-mcp` — the extraction path can lose the executable bit

If step 1 fails because of macOS 14+'s "App Management" protection, the install warns you; run it by hand once:

```bash
xattr -dr com.apple.quarantine "/Applications/Launcher.app"
```

### Upgrade and uninstall (Channel B)

```bash
brew outdated --cask --greedy     # check for a newer version (casks need --greedy to show up)
brew update && brew upgrade --cask launcher
brew uninstall --cask launcher
```

> A cask records **one specific version**: to see "what versions exist", go through the version manifest
> (`curl -fsSL .../install.sh | bash -s -- --list`, or `npx -y @becrafter/launcher versions`), and install older
> versions with Channel A. Homebrew only maintains the "latest stable" line — **pre-releases never enter the cask**.

---

## Channel C: npm

```bash
npx -y @becrafter/launcher
```

This npm package is **just an installer** (about 16KB): it downloads the genuine artifact from the official CDN into
`/Applications`. It contains no app, has no dependencies, and does nothing in `postinstall`. Requires Node 18+.

### Subcommands

| Command | What it does |
|---|---|
| `npx -y @becrafter/launcher` | Installs if missing; shows status if already installed |
| `npx -y @becrafter/launcher status` | Version check: installed / CDN latest / npm package latest |
| `npx -y @becrafter/launcher versions [--pre] [--json]` | List available versions; `--json` for scripts |
| `npx -y @becrafter/launcher install [--version <v\|latest>] [--dir <path>] [--force]` | Explicit install / force reinstall |
| `npx -y @becrafter/launcher uninstall` | Uninstall (including cleanup) |

| Option | Description |
|---|---|
| `--version <x.y.z\|latest>` | Specific version; defaults to this CLI's version |
| `--dir <path>` | Install directory; defaults to `/Applications`, falls back to `~/Applications` |
| `-f, --force` | Force reinstall even when the same version is present |
| `--pre` / `--json` | `versions` only: include pre-releases / output JSON |

Environment variables: `LAUNCHER_R2_BASE` replaces the download root, `LAUNCHER_INSTALL_DIR` is the same as `--dir`.

> **Why uninstall needs its own subcommand**: npm v7+ has no uninstall hook, so `npm uninstall` won't clean up the
> `.app` in `/Applications`; and `ignore-scripts=true` makes lifecycle scripts fail silently —
> so this package deliberately relies on no npm hooks at all and does its work through explicit subcommands.
>
> If you installed this CLI with `npm i -g`, you'll also need `npm uninstall -g @becrafter/launcher` after removing the app.

---

## Channel D: manual download

Artifacts are also backed up on **GitHub Releases** (with a sha256 per file); the primary CDN is
`https://repo.iskill.site/launcher/`:

```
Launcher-latest-arm64.zip      # alias: always points at the most recent stable release
Launcher-latest-x64.zip
Launcher-<version>-arm64.zip   # versioned filenames (the CDN caches by filename, so these are more reliable)
Launcher-<version>-x64.zip
Launcher-<version>-<arch>.dmg  # extra artifact for manual installs only; the other two channels consume zips
```

**Extract with `ditto`, not by double-clicking in Finder (which is equivalent to unzip)**:

```bash
ditto -x -k ~/Downloads/Launcher-0.1.4-arm64.zip /tmp/launcher-unzip
xattr -dr com.apple.quarantine /tmp/launcher-unzip/Launcher.app
mv /tmp/launcher-unzip/Launcher.app /Applications/
open /Applications/Launcher.app
```

⚠ **This route means clearing the quarantine flag yourself**: browser downloads tag files with
`com.apple.quarantine`, and since this project is ad-hoc signed and not notarized, the tag makes macOS declare it
"damaged" — with **no graphical way around it** (right-click → Open is only preserved for apps that have a
Developer ID signature but aren't notarized). That's why the three channels above are recommended.

---

## Versions: what exists, what's newest

There is exactly one source of truth for "what have we released" — the CDN:

| Want to know | Read from |
|---|---|
| **Which versions exist** | `<cdn root>/versions.txt` (plain text, one version per line: `0.1.4`; pre-release lines end with ` pre`) |
| **Which is the newest stable** | The HEAD redirect of the `Launcher-latest-<arch>.zip` alias |

All three channels and the app's own "Check for updates" read the same manifest, so you never get "the channel can
install a new version but the app says there's none".

**Pre-release rules**: version suffixes are limited to `alpha` / `beta` / `pre` / `rc` (e.g. `0.2.0-rc.1`).
Pre-releases **never touch the stable channels** — the `latest` alias and the Homebrew cask skip them, and the
in-app update check won't offer them either.

---

## Upgrading

The in-app "Settings → About → Check for updates" gives you the command matching the **detected install source**
(Homebrew / npx / curl), so you don't have to remember how you installed it.

| Install source | Upgrade command |
|---|---|
| Homebrew | `brew upgrade --cask becrafter/brew/launcher` |
| npm | `npx -y @becrafter/launcher` |
| curl / manual | `curl -fsSL https://repo.iskill.site/launcher/install.sh \| bash` |

---

## Uninstalling

Quit the app first (menu bar tray → Quit, or ⌘Q), then depending on how you installed it:

```bash
rm -rf /Applications/Launcher.app                 # channels A / C / D (adjust if installed under ~/Applications)
brew uninstall --cask becrafter/brew/launcher     # channel B
npx -y @becrafter/launcher uninstall              # channel C
```

**Leftover data** (the uninstaller won't remove it; clean up as needed):

| Path | Contents |
|---|---|
| `~/.config/launcher/config.json` | All settings (theme, language, `cmdTimeout`, service aliases…) |
| `~/Library/Application Support/becrafter-launcher/` | AI sessions (`ai-sessions.json`) and the key file (`ai-keys.json`, contents encrypted via the system keychain; plaintext API keys never touch disk) |
| `~/Library/Logs/BeCrafter-Launcher/cron/` | Scheduled task logs (split by hour, 3 days retention by default) |
| `~/.local/bin/launcher-mcp` | A symlink left behind if you clicked "Install to PATH" in the app |
| `~/Library/LaunchAgents/*.plist`, `crontab -l` | **The app never touches these** — tasks you created belong to macOS / cron, and uninstalling the app won't delete them |

---

## Troubleshooting

### "Damaged, move to Trash" when opening

The artifact carries `com.apple.quarantine` (only possible from a **browser download**). Run this once:

```bash
xattr -dr com.apple.quarantine /Applications/Launcher.app
open /Applications/Launcher.app
```

**Why the first three channels don't hit this**: the quarantine flag is set by the **downloading program**, not by the
network layer — browsers set it, `curl` doesn't; npm downloads via Node's fetch and doesn't set it either; Homebrew
does set it, which is why the cask's `postflight` clears it immediately. This is a required patch for this project's
"zero-cost distribution" scheme, not an optional nicety.

### "Cannot verify the developer" / want to confirm the signature

```bash
codesign -dv /Applications/Launcher.app     # expect Signature=adhoc
```

This project doesn't buy an Apple developer certificate ($99/year); artifacts are ad-hoc signed and not notarized.

### Wrong architecture installed / app won't open

The architecture test is **`uname -m`** (`arm64` → arm64 artifact, `x86_64` → x64 artifact).
On Apple Silicon, the arm64 artifact is recommended; the x64 one runs through Rosetta but is slower.
Confirm which one you have:

```bash
lipo -archs /Applications/Launcher.app/Contents/MacOS/Launcher
```

### `launcher-mcp: command not found` (when an external agent mounts the MCP server)

It means that link isn't on your PATH. Open the app → AI assistant → toolbar "Connect MCP" → click "Install to PATH"
(the app installs it into `~/.local/bin` **on your login shell's PATH**, repairing dangling or mispointing old links
in place). The dialog also gives you a copyable full-path command — installing the link isn't required.

### Slow download / can't reach the CDN

Point it at a mirror (the mirror only needs to mirror the CDN root; `versions.txt` lives there too):

```bash
LAUNCHER_R2_BASE=https://your-mirror.example/launcher \
  curl -fsSL .../install.sh | bash
```

### Verifying artifact integrity

The GitHub Release notes keep a sha256 for each zip:

```bash
shasum -a 256 ~/Downloads/Launcher-0.1.4-arm64.zip
```

---

## Appendix: the install contract shared by all channels

`scripts/install.sh` (bash) and `packaging/npm/cli.mjs` (Node) are two implementations of the same logic.
These invariants **must be kept in sync across both** (cross-file assertions live in `packaging/npm/contract.test.mjs`):

| Invariant | Value |
|---|---|
| Download root | `${LAUNCHER_R2_BASE:-https://repo.iskill.site/launcher}` |
| Artifact naming | `Launcher-[latest\|<version>]-<arch>.zip` |
| Architecture test | **`uname -m`** (not `process.arch`: that's the Node binary's own architecture, so an x64 Node on Apple Silicon would install the wrong one) |
| Extraction tool | **`ditto -x -k` is mandatory** (`unzip` and JS zip libraries drop symlinks and extended attributes, breaking the signature) |
| Install directory | `/Applications`, falling back to `~/Applications` when not writable |
| Finishing touch | `xattr -dr com.apple.quarantine` (defensive) |
| Integrity | Verify `Contents/MacOS/Launcher` exists |

"Which versions exist" and "what does latest point at" likewise share one source across all three channels
(`versions.txt` on the CDN and the `latest` alias), with cross-file assertions in `packaging/npm/contract.test.mjs`.
