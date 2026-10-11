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
- [6. Notebook](#6-notebook)
- [7. Editor guide](#7-editor-guide)
- [8. AI assistant](#8-ai-assistant)
- [9. Settings reference](#9-settings-reference)
- [10. Permissions and security](#10-permissions-and-security)
- [11. FAQ](#11-faq)
- [12. Where your data lives](#12-where-your-data-lives)
- [13. Glossary](#13-glossary)
- [14. Still stuck?](#14-still-stuck)

---

## 1. What each page manages

| Page | What it manages | What that is in the system |
|---|---|---|
| **Agents** | Long-running / background tasks: services and daemons that start at login | `launchd` (plist files + `launchctl`) |
| **Scheduled tasks** | Jobs that run on a timetable (the 3am backup kind) | `crontab` (per-user) / `/etc/crontab` (system-wide) |
| **Port services** | Who is listening on which port right now: what's holding 3000, can it be stopped | `lsof -iTCP -sTCP:LISTEN` |
| **Notebook** | Markdown notes about the three above, **linked to specific services** | plain `.md` files (your own folder) |
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
4. For logs, turn on **Record log** — the app funnels output into a fixed directory (see [§12](#12-where-your-data-lives))
5. **System-wide** tasks (writing `/etc/crontab`) require authorization when saving; if that file doesn't exist the system scope is unavailable (macOS protects it — the app won't create it for you)

### 2.3 Find and kill whatever is holding a port

1. Open **Port services** (auto-refreshes every 3 seconds while you're on the page)
2. Type the port number into the toolbar search, or find the grouped card
3. On the right of a card: **↗** opens `http://host:port` in your browser; **Copy** copies the full URL; **Restart** kills then relaunches with the recorded command line; **Stop** ends the process
4. Killing someone **else's** process (root, another user) pops the system authorization dialog first — see [§10](#10-permissions-and-security)

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

## 6. Notebook

One Markdown file per note, stored by default in `~/.config/launcher/notes/` (**Settings → Notes** lets you point it at an existing Obsidian vault).
The files are plain `.md` with a frontmatter block — edit them with Obsidian, iCloud or git and the app will notice and reload.

### The three panes

The left pane is the list (its search box looks at the **body**, not just titles). Write in the middle, preview on the right.
The title is shown as a whole path: the `folder/` prefix and the `.md` suffix are greyed out (they follow the file's
location and are not editable) — the middle part is the name you can change, and the file follows it when you leave the field.

There are only two rows up top: the title, and one row of "view switcher | links and tags". The switcher is three icon
buttons (split / edit-only / preview-only, with tooltips); the vertical bar separates it from the service links and tags,
which wrap onto more lines only when there are many. At the right end of the title row sit this note's actions:
**reference in AI** (✨, see "Referencing notes in the AI"), pin, delete. The list shows names only and is always sorted by most
recently updated — no sort control to set each time. Tags are no longer listed as a row of their own (they get
numerous and unreadable). Instead they work **through the search box**: if what you type matches a tag, notes carrying
that tag are **ranked first** and marked `#tag` at the end of the row so you can see why they matched. When nothing
matches a tag, you get the ordinary content results in exactly the same order as before.

While searching, results are shown **flat** rather than nested under folders — matches tend to be scattered across
folders and a flat list is easier to scan. The row's tooltip still shows the full path.

### Folders

**A folder is a real directory on disk** and the notes sit directly inside it, so the hierarchy you see in Finder or
Obsidian is exactly this one. Hovering a folder reveals four small buttons: new note here, new subfolder here, rename,
and delete (notes inside go to the Trash with it and can be recovered).
The Notebook page has no top bar: everything you need is in the left column, so the whole strip goes to the text.

There are exactly two creation entry points, each with one job:
- **the buttons on a folder row** → create **inside that folder** (a note or a subfolder)
- **the pair at the bottom of the list, "New note / New folder"** → create at the **top level**

So: use the row when you want it inside a folder, the bottom pair when you want it at the outermost level.

**Drag** a note or a folder to move it: drop it on a folder to move it inside, or on the empty area to move it back to
the top level. A folder cannot be dropped into itself (that would detach the whole subtree) — the app refuses.

Hover any row and two buttons appear on the right: **pin** and **delete**. Deleting goes to the system Trash as well.
Pinning does not touch the "updated" time — otherwise unpinning would make the note jump to the top of the
most-recently-updated order.

**Pinned notes always sit at the very top** of the list regardless of the sort order, and are not repeated inside the
folder tree — they live in the "Pinned" section. Click that row to collapse it (the state is remembered).

Drop an existing folder (an entire Obsidian vault, say) into the notes folder, or create directories and `.md` files
there directly: the app notices and refreshes on its own, no restart needed.

### Linking to a service

This is what makes it different from a plain notebook. "Link service" attaches a note to:

- a **Launch Agent** (by Label)
- a **cron job**
- a **port service**

The note then shows a chip like "Launch Agent · com.foo.bar", and **clicking it jumps straight to that service**.
The other direction works too: the "More" menu on an Agents card, a port service's "Configure" panel and a cron job's action row all offer "Related notes", which opens the list filtered to that service.

**A port-service link survives process restarts** — it records "port + program name", not the PID.
If the object changed but the link is still resolvable (scope moved, command edited) the chip turns amber with a button to update it; only a genuinely missing object shows as stale.

### Autosave and conflicts

While editing, a toolbar sits along the bottom: on the left the usual formatting buttons (bold / italic / inline code /
link | heading / list / task / quote | code block / image / **table** / **page embed** / **diagram**), on the right a
character count — or a short hint while the note is empty. `⌘B` / `⌘I` / `⌘K` map to bold, italic and link.
**Switching to preview-only folds the whole bar away** — formatting buttons only make sense while editing, and the
preview gets that height back.

The editor is a **source editor**: monospace, every line exactly the same height. Headings do not grow, code
blocks get no background panel, quotes get no bar — it does two things only: **colour** (markers dimmed,
keywords / strings / comments / links coloured, table delimiters dimmed, header row bold, task `[ ]` coloured,
callout markers coloured by type) and **glyph shape** (bold really looks bold, italic really slants). For
typeset output, look at the preview pane. Code colours are **the same set** on both sides — a `const` is one
colour either way.

In split view the two panes **scroll together** — scroll either one and the other follows. That works off "which
source line is this block", not off height ratios (the two panes are almost never the same height, and ratios drift
further apart the longer the note). The 🔗 button on the metadata row turns it off.

Saving happens about a second after you stop typing — there is no save button. **Renaming the title renames the
file too**: when you leave the title field the file follows the title (if the name is taken the app asks whether to
cancel or keep both).

Three things worth knowing:

- **The file is edited outside the app**: the app reloads it and tells you. If you had unsaved changes at that moment, a banner asks whether to use the disk version or keep yours — **neither side is lost by default**.
- **Frontmatter keys the app does not recognise** (Obsidian's `aliases`, `cssclasses`, …) are **preserved verbatim** and never rewritten. If the whole frontmatter block is in a shape it cannot parse (e.g. an unclosed fence), the app treats the file as plain body and only warns.

### Diagrams (Mermaid)

The rightmost toolbar button inserts a diagram. Pick a type (flowchart / mindmap / sequence / class / state / ER /
pie / gantt), choose a direction and theme, watch the live preview, then hit Insert. Hovering a rendered diagram
reveals **copy source / zoom / edit** — the pencil reopens that diagram's settings, and Update replaces just that
block, leaving the rest of the note untouched.

Diagrams are plain Mermaid fenced blocks (```` ```mermaid ````) and the **settings live in the source** (direction on
the `flowchart LR` line, theme in a `%%{init: …}%%` directive), so the file looks the same in Obsidian or on GitHub.
"Follow app" is the one exception: it writes **nothing** into the file and instead colours the diagram from the
current theme, so diagrams follow light/dark switches.

A syntax error does not vanish silently — that block shows Mermaid's error message next to your source.

### Callouts

Start a quote with `> [!NOTE]` and the whole block renders as a card with an icon and its own colour:

```markdown
> [!WARNING] Back up before changing ports
> Edit the plist without a backup and you are retyping it from memory.
```

Five types: `NOTE` (blue) · `TIP` (green) · `IMPORTANT` (purple) · `WARNING` (amber) · `CAUTION` (red).
The marker may be followed by a custom title; without one the type name is used. The body takes lists, code
blocks, images — anything.

**Typing `> [` in the editor pops up the five types**, Enter inserts the whole skeleton, and what you type next
is the body. Callout markers are colour-coded in the editor too, so a warning reads as a warning at a glance.

This syntax is **native to Obsidian and understood by GitHub** — the file does not turn into plain text elsewhere.

### Tables

The toolbar's table button opens an **8×8 grid**; drag to the size you want and click. You get an empty table with
a header row — the header cells are filled with placeholder names, because a fully blank header is a field of
borders with no visible top row.

### Page embeds

The globe button: paste an address, pick a height, insert. Two kinds of address:

- **Relative path** (`assets/report.html`) → a local page inside the notes folder, **no network request at all**;
- **URL** (`https://…`) → the preview **fetches that page over the network**.

⚠ The second one goes online — remote images (next section) take the same path. Those are the only two places
in the app that touch the network. The dialog changes colour to say so. The embedded page runs in a
**sandboxed iframe** and cannot reach the app itself.

The source looks like this, and can be written by hand:

````markdown
```embed
https://example.com
height: 420
```
````

Height is optional (380px default). If a site refuses to be framed the box stays blank — the address bar above it
has an "open in browser" button.

### Documents, video and audio

Same syntax as images; the extension picks the control:

```markdown
![](assets/screencast.mp4)
![](assets/recording.m4a)
![](assets/manual.pdf)
```

- **Video / audio**: played inline, and the scrubber works (the attachment protocol supports range requests, so
  it does not wait for the whole file);
- **PDF**: read inline using Chromium's built-in viewer;
- Supported extensions: `mp4` `webm` `mov` `m4v` `ogv` / `mp3` `m4a` `wav` `ogg` `flac` `aac` / `pdf`.

Everything lives in `assets/` inside the notes folder, next to your images.

### Images

Paste or drop a screenshot into the editor: it is stored under `assets/` in the notes folder and a `![](assets/…)` reference is inserted.

**Remote images (`https://…`) are displayed directly.** That means opening the note fires one request at that
address — the same online behaviour as page embeds (previous section). The rendered `<img>` carries
`no-referrer`, so at least "which note you came from" is not sent along. If the host blocks hotlinking or the
address is dead, that spot degrades to a clickable chip instead of a broken-image icon.

The attachment protocol only serves whitelisted types under `assets/` in the notes folder, and path traversal is
blocked in the protocol handler.

### Task lists

`- [ ]` / `- [x]` are checkable in the preview, and toggling one edits the source file — **⌘Z undoes it**.

### Letting the AI write notes

The assistant has six note tools (list / read / view image / write / link / delete). Try "write up the troubleshooting we just did for port 8080 as a note" —
it attaches the service link itself. Writes still go through the approval card, which turns red when existing body text would be overwritten.

### Referencing notes in the AI

Three ways in, and all of them read the **body as it is on disk right now**:

- **Type `@` in the AI input** → pick from the "Notes" group. The checkbox at the start of a row lets you
  collect several and attach them all with one click at the bottom; clicking the row itself references just
  that one and closes the popover. Typing two or more characters also searches note bodies.
- **Click the ✨ button in the note header** → jumps to the AI page with that note attached.
- **Select a passage in the editor first, then click that button** → only the **selected passage** is
  referenced, not the whole note. Handy for "just this log excerpt, take a look".

Each reference becomes a chip above the input (green for notes); click ✕ to drop it. Up to 10 per message.

Worth knowing:

- **A reference is not a paste**: the body is read once, at send time, and folded into that turn. It is
  **not written into the conversation record** and does not appear in the bubble — so if you edit the note
  afterwards, the next turn sees the new version.
- **The body stays in context**: a referenced note is re-sent to the model on every following turn (that is
  how it avoids "forgetting" the note). That costs tokens — think twice before referencing a huge note.
  64 KiB per note, 128 KiB of references per message; anything over that is reported by name.
- **Images are fetched on demand**: screenshots inside a note are not pushed to the model automatically
  (that would bloat the request). When the body mentions one, the assistant knows and calls
  `read_note_image` itself. An image it looked at is **visible for that turn only** and is not written into
  the conversation record — ask again and it re-reads the local file, which is nearly free.
- **Deleted or renamed notes**: the model is told "no longer exists" instead of being handed stale text.
- Referencing is not the same as having read: when asked to **rewrite** a note the assistant still calls
  `read_note` first, so it never overwrites your text based on a possibly truncated reference.

---

## 7. Editor guide

This chapter is a **reference** for the things you would not find by poking around. To see them live,
open the **Notes feature tour** note in your notes folder (generated on first run when the folder is
empty) and edit it.

### The editor is a source editor

The left pane is the **source**, the right pane is the **output**. The editor does exactly two
things: **colour** (markers dimmed, syntax coloured) and **glyph shape** (bold looks bold, italic
slants). Headings do not grow, code blocks get no background panel — so every line is exactly the
same height and it reads like source you can edit.

That is deliberate: the moment headings grow or code blocks get a background, line heights stop
matching and it reads like a **rendered document** rather than source you are editing. **Typesetting
is the preview pane's job.**

### Size: written in the brackets, or dragged out

Images, video, audio and PDF carry their size in the alt text — Obsidian's syntax, which Obsidian
understands natively:

| Syntax | Meaning |
|---|---|
| `![cover\|300](assets/a.png)` | width 300px |
| `![cover\|300x200](assets/a.png)` | 300 × 200 (stretches) |
| `![\|x400](assets/a.pdf)` | height only (a PDF is always full width) |

**Click a media block in the preview** and a handle appears in its bottom-right corner; drag it to
resize, and the syntax above is rewritten on release. Images / video / audio drag width (height
follows the aspect ratio); **a PDF or a page embed** drags height. Clamped to 40–2400px.
**All four media types plus page embeds resize this way**, not just images.

If the same image appears more than once in the note the app may not be able to pin down which one —
it says so and **changes nothing**, rather than picking one at random.

### Tables are editable in place

**Double-click a cell** in the preview to edit it (Enter commits, Escape cancels), and the table
re-aligns itself. Hover the table and `×` buttons appear in the row gutter and on the header cells
(delete that row / column); below the table sit "add row" and "add column".

What changes is the **source**: re-aligning only touches whitespace, never cell content. Deleting the
last remaining column is refused — a table with no columns is not a table.

**A cell can hold block content too**: use `<br>` as the line separator inside that one line of source
— lists, code blocks, diagrams, nested tables, images / video / PDF all fit (write a literal pipe as
`\|`, otherwise it splits the column). Task lists, tables and diagrams inside a cell are **read-only**:
they all come from that same line of source, and writing back by line number would corrupt the row.
Images / video / diagrams inside a cell scale with the cell.

**Column widths and row heights** live in the ````table fence (`cols=200,100,auto`, `rows=80,40`), or
you can **drag a column / row boundary** in the preview and the number is written back on release. For
"image left, text right" layouts, add `layout` to the fence — the table becomes a grid: no borders,
and the first row stops being a header.

For live examples, open the **Notes feature tour** note in your notes folder.

### Table borders: a global default plus per-table overrides

GFM's table syntax has nowhere to put attributes, so borders work in two levels:

- **Global**: Settings › Notebook › Table style — border weight (none / thin / medium / thick) and colour.
- **Per table**: wrap the table in a `table` fence and override only what you name:

````markdown
```table border=none
| Borderless | Still readable via alignment |
|---|---|
| A | B |
```
````

Only two keys are recognised: `border=none|thin|medium|thick` and `color=#8b5cf6` (or a colour name).
Unknown keys are ignored — one misspelled word should not turn a table into an error message.

The trade-off is that this fence shows up as a code block in Obsidian / GitHub. So use it for the
**occasional** table; the default lives in Settings, and a note with no fences at all still gets
consistent, good-looking tables.

### Code blocks

Name the language inside the fence and you get syntax highlighting. **Hover a code block** and a
language badge plus a copy button appear in its top-right corner. It copies the **raw code**, with no
highlight markup — paste it straight into a terminal.

40+ languages are covered: `js` `ts` `jsx` `tsx` `json` `html` `css` `scss` `xml` **`plist`**
`markdown` `sh` `bash` `zsh` `py` `yaml` `toml` `ini` `sql` `go` `rust` `c` `c++` `java` `kotlin`
`swift` `ruby` `lua` `perl` `diff` `dockerfile` `nginx` `powershell` … Anything unrecognised is
shown as plain text rather than mis-coloured.

### Callouts

`> [!TYPE]`, five of them: `NOTE` (blue) `TIP` (green) `IMPORTANT` (purple) `WARNING` (amber)
`CAUTION` (red). Whatever follows the marker becomes a custom title. **Typing `> [` in the editor
pops up the five types.**

**A plain quote (a line starting with `> `, no `[!TYPE]`) is rendered block by block too** — it
takes lists, code blocks, tables and nested quotes.

This syntax is native to Obsidian and understood by GitHub — the file does not turn into plain text
elsewhere.

### Page embeds

The globe button on the toolbar: paste an address, pick a height. A relative path
(`assets/report.html`) points at a local page inside the notes folder and makes **no network
request**; a URL (`https://…`) makes the preview **fetch that page**.

### Diagrams

The rightmost toolbar button inserts a Mermaid diagram (flowchart / mindmap / sequence / class /
state / ER / pie / gantt) with visual direction and theme controls. Hovering a rendered diagram
reveals copy-source and edit. Settings are written back as **standard Mermaid source**, so the file
looks the same in Obsidian or on GitHub.

### Linked scrolling

In split view both panes scroll together, driven by "which source line is this block" rather than by
height ratio — the two panes are almost never the same height, and ratios drift apart. The 🔗 button
on the metadata row turns it off.

### One-line reference

| Want | Write |
|---|---|
| Callout | `> [!WARNING]` |
| Task list | `- [ ] something` |
| Table | `\| a \| b \|` then `\|---\|---\|` |
| Borderless table | wrap in ` ```table border=none ` |
| Code block | ` ```bash ` |
| Image size | `![cover\|300](assets/a.png)` |
| Video / audio / PDF | `![](assets/a.mp4)` (the extension picks the control) |
| Page embed | ` ```embed ` plus a line with the address |
| Diagram | ` ```mermaid ` |
| Horizontal rule | `---` |

---

## 8. AI assistant

### Configure it first

**Settings → AI assistant**: pick a protocol (Anthropic / OpenAI-compatible) → enter the endpoint and **API Key** → pick a model. Hit "Test connection" to verify.

- The key is stored **locally only**, encrypted via the system keychain (never plaintext on disk), and cleared along with "Restore defaults"
- The OpenAI-compatible protocol covers most third-party gateways (DeepSeek, Qwen, self-hosted vLLM…); enter the endpoint up to `/v1`

### What it can do

It calls the app's own tool layer (**reading real system state**, not mock data) — 20 tools in total:

- **12 read-only**: list/query agents, scheduled tasks, port services; read raw plist source, read logs, check a task's run state, read notes (including screenshots inside them)…
- **8 requiring authorization**: edit plists, write files, perform write operations — each execution pops an **authorization card** stating **the exact command about to run**; it only runs once you hit "Allow"

Whether write tools are **visible** is decided by the **MCP permission mode** (default `readOnly` exposes only the 12 read-only tools); but **even when visible, execution still needs your per-call authorization**.

### Connecting external agents (MCP)

"AI assistant → toolbar **Connect MCP**" offers two forms:

| Form | Description |
|---|---|
| **stdio** | The `launcher-mcp` command (an entry point bundled in the app). Hit **Install to PATH** once and you can mount it by name alone, e.g. `claude mcp add launcher -- launcher-mcp`; installing is optional — the dialog always shows a copyable full-path command |
| **HTTP** | `http://127.0.0.1:7788/mcp`, available while the app runs, no extra process needed |

The top of the dialog shows the real state of the PATH link (installed / not installed / dangling / pointing at another copy); hit "Repair link" when it's out of sync.

---

## 9. Settings reference

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
| **AI assistant** | Protocol / endpoint / key / model | See [§8](#8-ai-assistant) |
| | Runtime options | Tool-call limit, streaming, request timeout; MCP permission mode (read-only / full) |
| **About & Diagnostics** | Version / architecture / install source | The "install source" decides which upgrade command the update check gives you |
| **Login items** | — | Read-only explainer: how macOS login items relate to this app |

---

## 10. Permissions and security

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

## 11. FAQ

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

## 12. Where your data lives

| Path | Contents |
|---|---|
| `~/.config/launcher/config.json` | All settings (theme, language, timeouts, service aliases/overrides…) |
| `~/Library/Application Support/becrafter-launcher/` | AI sessions (`ai-sessions.json`) and the key file (`ai-keys.json`, encrypted via the system keychain) |
| `~/Library/Logs/BeCrafter-Launcher/cron/` | Scheduled task logs (split by hour) |
| `~/Library/LaunchAgents/`, `/Library/LaunchAgents/`, `/Library/LaunchDaemons/` | Your Agents (the app manages these files directly) |
| `crontab -l` / `/etc/crontab` | Your scheduled tasks (user-level / system-level) |

---

## 13. Glossary

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

## 14. Still stuck?

1. Check the FAQ above, and for install-related problems → [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md) (covers "damaged", architecture, upgrade channels, etc.)
2. Packaging and signing → the "Why does it say damaged" section of [docs/install.md](https://github.com/BeCrafter/Launcher/blob/main/docs/install.md)
3. When filing an issue, include: **app version** (Settings → About & Diagnostics), macOS version, task name / port number, the relevant plist or the `crontab -l` line, and the raw log — with those it's usually a one-shot diagnosis

→ [File an issue](https://github.com/BeCrafter/Launcher/issues)
