# Launcher User Guide

This is the **usage** guide: what a button does, why a change didn't take effect, why a status looks the way it does.
Install / upgrade / uninstall live in [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md); project overview in [README](https://github.com/BeCrafter/Launcher/blob/main/README.md).

> Also available in-app: the **Help** button at the bottom-left opens this page.

## Contents

- [1. What each page manages](#1-what-each-page-manages)
- [2. Three most common tasks (step by step)](#2-three-most-common-tasks-step-by-step)
- [3. Agents (launchd)](#3-agents-launchd)
- [4. Scheduled tasks (crontab)](#4-scheduled-tasks-crontab)
- [5. Port services](#5-port-services)
- [6. AI assistant](#6-ai-assistant)
- [7. Settings reference](#7-settings-reference)
- [8. Permissions and security](#8-permissions-and-security)
- [9. FAQ](#9-faq)
- [10. Where your data lives](#10-where-your-data-lives)
- [11. Glossary](#11-glossary)
- [12. Still stuck?](#12-still-stuck)

---

## 1. What each page manages

| Page | What it manages | What that is in the system |
|---|---|---|
| **Agents** | Long-running / background tasks: services and daemons that start at login | `launchd` (plist files + `launchctl`) |
| **Scheduled tasks** | Jobs that run on a timetable (the 3am backup kind) | `crontab` (per-user) / `/etc/crontab` (system-wide) |
| **Port services** | Who is listening on which port right now: what's holding 3000, can it be stopped | `lsof -iTCP -sTCP:LISTEN` |
| **AI assistant** | Ask about the three above in plain language, or have it make changes (with authorization) | The app's own tool layer (no mock data) |

**Settings** at the bottom-left holds the app's own preferences (theme, language, timeouts, permissions); the last tab, "About & Diagnostics", shows the version and the update check.

---

## 2. Three most common tasks (step by step)

### 2.1 Make a script start at login

1. Open **Agents** → toolbar **New Task** → pick a scope
   - **User** (`~/Library/LaunchAgents`): applies to you only, **no admin authorization needed** ← use this day to day
   - **Global** (`/Library/LaunchAgents`) / **Daemon** (`/Library/LaunchDaemons`): applies to all users; saving requires authorization
2. In the drawer's **Edit** tab, fill in:
   - **Label**: the unique identifier, conventionally reverse-DNS (e.g. `com.me.backup`); **don't change it later** (it *is* the identity)
   - **Program**: the **absolute path** of the executable to run (`/usr/local/bin/myscript.sh`); remember `chmod +x` on scripts
   - **Arguments**: one per line (**never** as a single string)
3. Expand the **Lifetime** card → turn on **Load at login** (= writes a `RunAtLoad` or `KeepAlive` policy)
4. Save → back in the list, hit **Start** on the card

> Want it "always alive, restarted if it dies"? Pick a KeepAlive policy. Only want "run once at login"? Leave it at RunAtLoad.

### 2.2 Run a command on a schedule

1. Open **Scheduled tasks** → toolbar **New Task**
2. Pick a preset (daily / hourly / weekly…) or type the five-field expression; the field below translates it into plain language and shows the **next run time**
3. Use **absolute paths** in the command (`cron`'s `PATH` is minimal — `node foo.js` often can't find node)
4. For logs, turn on **Record log** — the app funnels output into a fixed directory (see [§10](#10-where-your-data-lives))
5. **System-wide** tasks (writing `/etc/crontab`) require authorization when saving; if that file doesn't exist the system scope is unavailable (macOS protects it — the app won't create it for you)

### 2.3 Find and kill whatever is holding a port

1. Open **Port services** (auto-refreshes every 3 seconds while you're on the page)
2. Type the port number into the toolbar search, or find the grouped card
3. On the right of a card: **↗** opens `http://host:port` in your browser; **Copy** copies the full URL; **Restart** kills then relaunches with the recorded command line; **Stop** ends the process
4. Killing someone **else's** process (root, another user) pops the system authorization dialog first — see [§8](#8-permissions-and-security)

---

## 3. Agents (launchd)

### What the statuses mean

| Card status | Meaning |
|---|---|
| **Running** | Loaded + a process is alive (PID, uptime, CPU / memory shown alongside) |
| **Waiting** | Loaded but no process right now: waiting for a trigger (login, interval, watchdog) |
| **Stopped** | Not loaded (or loaded but disabled) |
| **Unsaved draft** | Created but not yet written to disk — every action button is disabled while this is true |

There's also a read-only orange badge, **Disabled**: that's `launchctl`'s "don't load by default" flag (persists across reboots) — a different thing from "is it loaded right now".

### What the four actions actually do

The UI only exposes **intent**; the `enable → bootstrap → kickstart` ordering is handled internally, so you never see a button greyed out "because of the order":

| Button | What actually happens |
|---|---|
| **Start** | Ensure enabled → load (bootstrap) → run once immediately if needed |
| **Stop** | Remove from launchd (bootout) — **this run only**, doesn't change "start at login" |
| **Restart** | If running, `kickstart -k`; if not loaded, the start sequence |
| **Load at login** | Changes the **flag** (enable / disable); does **not** touch the current running state |

Two things that are easy to misread:

- **Stop ≠ unload/delete**: the card is still there, the plist is still there, it's just not running under launchd. To delete the file, use **Delete** at the bottom of the drawer.
- **"Load at login" is across reboots**: turning it off won't stop a process that's running now; turning it on won't start one either — that's what **Start** is for.
- Starting a task that's **disabled** makes the app ask "enable auto-load too?" — because launchd's `disable` **blocks** loading. That's a system rule, not an app limitation.

### Why some files can only be edited as XML

The form covers the most common keys (19 of them). For the two cases below, the save button is disabled with a per-key explanation — switch to the **XML** tab instead:

- **The form owns this key but can't express the current form**: e.g. both `Program` and `ProgramArguments` present, a `KeepAlive` sub-key the form doesn't know, an environment variable that isn't a string
- **The structure can't be patched incrementally**: the file as a whole isn't in a form that can be patched node by node (the app will tell you explicitly)

Other keys the form **doesn't know** (e.g. `MachServices`, `Umask`) do **not** lock the form: they're **preserved verbatim** on save, and a "preserved as-is on save" notice appears at the top of the page.

> Saving a plist is a **node-level patch**: only what you touched is rewritten, comments and layout are left alone where possible.

### Other notes

- **Homebrew services**: entries managed by `brew services` carry a Homebrew badge, and start/stop go through brew's own routing (otherwise the two sides fight)
- **"Loaded but the plist is gone"**: still registered in launchd but the file is missing (usually deleted by hand). An orange banner appears on the card — hit **Remove** to clear it out of launchd
- **XML tab**: edit the raw source directly; a syntax check runs before saving (equivalent to `plutil -lint`)
- **Log tab**: two switchable sources — **Log files** (tails the files pointed at by `StandardOutPath` / `StandardErrorPath`) and **System log** (`log show`, filterable by level)
- **External changes sync automatically**: add or remove a plist in Finder or another tool and the list refreshes (FSEvents watching can be turned off in Settings)

---

## 4. Scheduled tasks (crontab)

- **Expression**: five fields (minute hour day month weekday). The field below gives a plain-language description and the **next run time** in real time; when both `dom` (day) and `dow` (weekday) are restricted, cron's OR rule applies
- **Built-in presets**: daily / hourly / weekly / monthly / at boot and other common combinations, one click to fill in
- **Disabling a task**: not deleting the line, but adding a marker at its start (the app recognises it) — re-enable any time
- **Logs**: after turning on "Record log", the app rewrites that line to redirect output into a fixed directory, **split by hour** (so expired files actually get cleaned up). The log drawer has the segment list on the left and the body on the right; delete segments individually or clean up expired ones in one go

### I configured a log path, so why are there never any logs?

The most common cause is an **unescaped `%`** in the command: `crontab` treats `%` as a newline and **truncates the command there** (everything after it becomes the command's stdin), so the task fails silently and the log file is never created.
Typical victims: `date +%Y-%m-%d`, `strftime('%H')`.

How the app detects and fixes it: a yellow **Needs escaping** warning appears on the card → click it and the `%` on that line becomes `\%` (only those characters change, everything else is left alone), after which the task runs and produces logs normally.

### Other common "it didn't run"

| Symptom | Common cause |
|---|---|
| Didn't run at all | The command isn't an absolute path; cron's `PATH` is short, so `node`/`python3` often aren't found |
| Works by hand, not under cron | Different environment (`HOME`, `PATH`); add an explicit `cd` and absolute paths to the command |
| Log file is empty | Output went to stderr but "Record log" wasn't on; or the `%` truncation above |
| Can't edit a system task | `/etc/crontab` doesn't exist (macOS prevents creating it); user-level is unaffected |

---

## 5. Port services

- **How the grouping works**: the listening process's name/command line is cross-checked against the `brew services` list, common runtimes (node) and Docker containers, landing in **Homebrew / Node.js / Process / Docker**; hover the type badge to see the evidence
- **That pile of system processes is normal**: on macOS almost every GUI app opens a few local IPC ports (`ControlCenter`, `FinderSync`…). They're bound to `127.0.0.1` or `*` only — **don't just kill them**, the owning app will misbehave
- **Stop vs Restart**: stop is `SIGTERM`, escalating to `SIGKILL` after 5 seconds; restart relaunches **with the recorded command line** — if the original process belonged to another user, the restarted one runs as you (the app says so up front)
- **Renaming / Host / Path**: double-click a card's name to rename in place; **⚙** sets an alias, Host and path, after which **↗ Open** and **Copy** both use the full `http://host:port/path` address. These overrides are keyed by "port + program name" and **survive process restarts**
- **"Scan failed" banner**: this round couldn't read system state (`lsof` / `ps` misbehaved); the list shows the **last successful result**, not the current truth. It refreshes automatically once recovered
- **Docker group**: when Docker isn't installed or isn't running, the group states the reason (CLI missing / daemon down / timed out) instead of silently disappearing

---

## 6. AI assistant

### Configure it first

**Settings → AI assistant**: pick a protocol (Anthropic / OpenAI-compatible) → enter the endpoint and **API Key** → pick a model. Hit "Test connection" to verify.

- The key is stored **locally only**, encrypted via the system keychain (never plaintext on disk), and cleared along with "Restore defaults"
- The OpenAI-compatible protocol covers most third-party gateways (DeepSeek, Qwen, self-hosted vLLM…); enter the endpoint up to `/v1`

### What it can do

It calls the app's own tool layer (**reading real system state**, not mock data) — 14 tools in total:

- **9 read-only**: list/query agents, scheduled tasks, port services; read raw plist source, read logs, check a task's run state…
- **5 requiring authorization**: edit plists, write files, perform write operations — each execution pops an **authorization card** stating **the exact command about to run**; it only runs once you hit "Allow"

Whether write tools are **visible** is decided by the **MCP permission mode** (default `readOnly` exposes only the 9 read-only tools); but **even when visible, execution still needs your per-call authorization**.

### Connecting external agents (MCP)

"AI assistant → toolbar **Connect MCP**" offers two forms:

| Form | Description |
|---|---|
| **stdio** | The `launcher-mcp` command (an entry point bundled in the app). Hit **Install to PATH** once and you can mount it by name alone, e.g. `claude mcp add launcher -- launcher-mcp`; installing is optional — the dialog always shows a copyable full-path command |
| **HTTP** | `http://127.0.0.1:7788/mcp`, available while the app runs, no extra process needed |

The top of the dialog shows the real state of the PATH link (installed / not installed / dangling / pointing at another copy); hit "Repair link" when it's out of sync.

---

## 7. Settings reference

| Group | Key | What it does |
|---|---|---|
| **General & Appearance** | Theme | Dark / Light / Follow system |
| | Language | Simplified Chinese / English (takes effect immediately) |
| | Launch at login | Adds this app itself to your login items (on by default) |
| | Keep in menu bar when window closes | Closing the window doesn't quit; click the Dock or menu bar icon to bring it back |
| | Show menu bar icon / Show Dock icon | The two entry points can each be turned off |
| | Menu bar badge | Shows the number of running tasks next to the menu bar icon |
| **Launchd engine** | FSEvents directory watching | Auto-refresh the list when external tools add/remove plists (turn off for manual refresh only) |
| | Command timeout | Upper bound for waiting on `launchctl` / `kill`; raise it on slow machines or with many tasks |
| | Scheduled task log retention | Log segments older than this are cleaned up automatically (3 days by default) |
| **Plist editor** | New task label prefix | Default Label prefix when creating an Agent (`com.user.` by default) |
| | XML indentation | Indentation used when saving/formatting plists (2 spaces / 4 spaces / Tab) |
| **Permissions & elevation** | Quiet period | Don't ask again for this long after authorizing (aligned with macOS's ~5 minute authorization cache) |
| | Confirm dangerous actions | When off, deletes and similar stop asking twice (on by default) |
| **AI assistant** | Protocol / endpoint / key / model | See [§6](#6-ai-assistant) |
| | Runtime options | Tool-call limit, streaming, request timeout; MCP permission mode (read-only / full) |
| **About & Diagnostics** | Version / architecture / install source | The "install source" decides which upgrade command the update check gives you |
| **Login items** | — | Read-only explainer: how macOS login items relate to this app |

---

## 8. Permissions and security

**When the system authorization dialog appears** (app explains intent → native system dialog → you enter your password → the app continues):

- Reading/writing **system-level** files: `/Library/LaunchAgents`, `/Library/LaunchDaemons`, `/etc/crontab`
- Stopping or restarting processes that **belong to another user** (including root)

**The app never touches your password**: it goes only into macOS's native authorization dialog (the app neither reads nor stores it).

**Which operations really change your system** (all only after you click, and the UI says so):

| Operation | What changed | How to roll back |
|---|---|---|
| Create / save an Agent | Writes a `.plist` into the corresponding directory | **Delete** at the bottom of the drawer (or remove the file in Finder) |
| Start / stop / restart | Only launchd's runtime state | The opposite operation |
| Load at login | `launchctl`'s flag (across reboots) | Turn the switch off |
| Create / modify a scheduled task | Rewrites `crontab` (or `/etc/crontab`) | Delete in-app, or edit back with `crontab -e` |
| Kill / restart a port process | Terminates a real process | Restart relaunches with the recorded command line; some processes can only be restarted by relaunching their host app |
| AI write operations | Executed only after per-call confirmation on the authorization card | Same as above |

---

## 9. FAQ

**Q: I clicked "Start", why does the status change a few seconds later?**
`launchctl`'s state propagation has roughly a 2-second lag, and restarts (`kickstart -k`) are throttled by the system. The app refreshes automatically afterwards — just wait a moment.

**Q: The task shows "Stopped" but I can still see the process in `ps`?**
Two common cases: ① that process was started by you in a terminal and isn't managed by launchd (the app stopped launchd's copy); ② the task has `KeepAlive`, so killing it just gets it restarted immediately — to stop it, turn the policy off first or disable the task.

**Q: I edited a plist (or edited it elsewhere), why didn't the UI change?**
The list refreshes automatically; but **changes need a reload to take effect** — saving in the app reloads "tasks that were already loaded", while files edited by hand in Finder need a **Restart** on the card (or **Stop → Start**).

**Q: Does deleting a task delete its logs too?**
No. Deleting removes only that task; logs stay in the fixed directory and are cleaned up according to "Scheduled task log retention".

**Q: I hit "Stop" on a port service and the process came back?**
Something else is supervising it: an Agent with `KeepAlive`, an app's own auto-restart, or a Docker container (use the stop button in the Docker group, not kill).

**Q: Why can't I edit a Homebrew service's XML?**
It's managed by `brew services`; editing the file directly fights with brew's records. Use `brew services stop`, edit, then `start`.

**Q: If I quit this app, will my tasks keep running?**
Yes. Tasks belong to `launchd` / `cron`; the app is just their UI.

**Q: If I uninstall the app, will my tasks disappear?**
No. Uninstalling won't delete your plists or crontab entries (cleanup list in [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md)).

**Q: How do I send logs to someone for troubleshooting?**
Agent: drawer → **Log** tab → export (or hand over the file at `StandardOutPath`).
Scheduled task: log drawer → pick a segment → copy the body.

**Q: Will the AI send my information anywhere?**
Only conversations you start go to the model endpoint you configured; the app itself has no telemetry and no account system.

---

## 10. Where your data lives

| Path | Contents |
|---|---|
| `~/.config/launcher/config.json` | All settings (theme, language, timeouts, service aliases/overrides…) |
| `~/Library/Application Support/becrafter-launcher/` | AI sessions (`ai-sessions.json`) and the key file (`ai-keys.json`, encrypted via the system keychain) |
| `~/Library/Logs/BeCrafter-Launcher/cron/` | Scheduled task logs (split by hour) |
| `~/Library/LaunchAgents/`, `/Library/LaunchAgents/`, `/Library/LaunchDaemons/` | Your Agents (the app manages these files directly) |
| `crontab -l` / `/etc/crontab` | Your scheduled tasks (user-level / system-level) |

---

## 11. Glossary

| System term | In plain language |
|---|---|
| **launchd** | macOS's background task supervisor (starts and watches tasks at boot/login) |
| **LaunchAgent** | A launchd task belonging to a user (runs after login, has a graphical session) |
| **LaunchDaemon** | A system-level launchd task (runs at boot as root, no graphical session) |
| **plist** | A launchd task's configuration file (XML) |
| **Label** | A task's unique identifier and its "ID card"; renaming it is really a different task |
| **Load / unload** | `bootstrap` / `bootout`: hand a task to launchd / take it back |
| **Enable / disable** | `enable` / `disable`: the across-reboot "load automatically?" flag; `disable` **blocks** loading |
| **Run now** | `kickstart`: make an already-loaded task run once right now |
| **KeepAlive** | Restart the process whenever it exits (can be conditional, e.g. "only on crash", "not on clean exit") |
| **RunAtLoad** | Run once immediately when loaded |
| **StartInterval / StartCalendarInterval** | Run every N seconds / run by calendar (hour:minute, weekday) |
| **crontab** | The traditional scheduled-task table (read by the `cron` daemon) |
| **cron expression** | Five fields: `minute hour day month weekday`; `*` means any value |
| **lsof** | The "who has this port/file open" query tool — the data source for the Port services page |
| **PID** | Process ID |

---

## 12. Still stuck?

1. Check the FAQ above, and for install-related problems → [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md) (covers "damaged", architecture, upgrade channels, etc.)
2. Packaging and signing → the "Why does it say damaged" section of [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md)
3. When filing an issue, include: **app version** (Settings → About & Diagnostics), macOS version, task name / port number, the relevant plist or the `crontab -l` line, and the raw log — with those it's usually a one-shot diagnosis

→ [File an issue](https://github.com/BeCrafter/Launcher/issues)
