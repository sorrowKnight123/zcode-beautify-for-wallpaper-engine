# zcode-beautify

[English](README.md) | [中文](README.zh-CN.md)

Beautify the **ZCode desktop client**: use any image — or any **video / Wallpaper Engine scene wallpaper** — as a background wallpaper and adapt the whole UI with Material Design 3 (Monet) dynamic color — plus a live settings panel for real-time tuning.

> 📷 Screenshot welcome — PRs adding one to `docs/screenshot.png` are appreciated.

## Features

- **Dynamic wallpapers** — import a Wallpaper Engine **scene** (`.pkg` or workshop directory) or a plain **video** (`.mp4`/`.webm`): scenes are rendered in a dedicated Wallpaper Engine window, captured through Desktop Duplication and processed into a perfectly seamless loop (first frame == last frame); long videos are trimmed to a middle segment. Loops are cached content-addressed and streamed to the renderer over HTTP — motion with no interaction and no sound.
- **Wallpaper** — any local image becomes a fixed background layer behind the UI, with three framing modes: `cover` (fill and crop), `contain` (letterboxed over a blurred backdrop of the same picture), and `smart` — a local AI-style analysis that finds the salient subject and picks the best framing and focus point automatically.
- **Monet theming** — a source color is extracted from the wallpaper with Google's official MD3 algorithm; light/dark palettes are mapped onto ZCode's semantic CSS variables (35+ tokens).
- **Live settings panel** — a draggable panel inside ZCode with blur/dim sliders, Monet and wallpaper-visibility toggles, one-click wallpaper swap, a native file-picker import for dynamic wallpapers (with progress bar and dependency guidance), a grouped wallpaper library, and reset. Changes preview instantly and persist.
- **Zero-touch serve** — the MCP server starts the background service automatically when ZCode launches, so the panel is simply always there.
- **Conversation control** — bundled slash command `/beautify` and MCP tools (`set_background`, `import_scene_wallpaper`, `apply_options`, …) let the ZCode agent set the wallpaper or tune the theme on your behalf.
- **Self-healing** — while `serve` runs, the theme survives renderer reloads automatically; the last look is also cached in `localStorage` as a fallback.

## How it works

ZCode is an Electron app whose UI theming is driven by Tailwind v4 `--color-*` CSS custom properties, and production builds start **without** a debug port. This plugin:

1. starts ZCode with `--remote-debugging-port=9222` (one-time `launch`);
2. connects over the Chrome DevTools Protocol and injects CSS/JS into the renderer:
   - a fixed-position wallpaper layer (image embedded as data URI),
   - translucent background variables so the wallpaper shows through,
   - MD3 light/dark palettes overriding ZCode's semantic tokens;
3. keeps the injection sessions open (`serve`) so the theme and the settings panel survive renderer reloads.

It never modifies ZCode's installation files, so ZCode upgrades are unaffected.

## Requirements

- Node.js ≥ 20 available on your PATH.
- ZCode desktop client (Windows / macOS / Linux).
- For dynamic wallpapers (optional): **Wallpaper Engine** (Steam) and **ffmpeg ≥ 5.0** on PATH — both are auto-detected, and the panel shows install guidance when missing. Capture uses the Desktop Duplication API, so dynamic import is **Windows-only**; static image wallpapers work everywhere.

## Two packages, both installable by handing an AI the link

Give your AI agent just <https://github.com/Logocceai/zcode-beautify> — it
clones the repo and follows the instructions inside. Pick the right one:

| | **Plugin package** (`INSTALL-FOR-AI.md`) | **Skill pack** (`skill-pack/SKILL.md`) |
|---|---|---|
| Target | The **ZCode desktop client** | **Any** Electron app |
| AI's role | Installer — sets up the ready-made plugin | Developer — builds the tool from scratch |
| You say | "Install this beautify plugin in my ZCode" | "Build wallpaper/color beautification for my XX app" |
| Result | Working `/beautify` command + MCP tools | A new local beautify tool |

Copy-paste prompt for the plugin:

```text
https://github.com/Logocceai/zcode-beautify
Install this beautify plugin into my ZCode desktop client. Follow
INSTALL-FOR-AI.md in the repository.
```

Offline? Both packages are attached to the
[releases page](https://github.com/Logocceai/zcode-beautify/releases) as zips.

## Install (manual paths)

### Option A — ZCode plugin marketplace (recommended)

1. Open ZCode → **Settings → Plugin Management → Discover**.
2. Click **+** and add this repository (GitHub URL or a local clone path).
3. Click **Get** on the *zcode-beautify* card. The `/beautify` command and MCP tools are available immediately.

The published repo ships prebuilt single-file bundles in `dist/`, so no build step is needed on your machine.

### Option B — clone and run

```bash
git clone https://github.com/Logocceai/zcode-beautify.git
cd zcode-beautify
node dist/cli.js --help        # prebuilt bundle, zero install
```

## Quick start

```bash
# 1) Quit ZCode completely, then start it with the CDP debug port (one-time).
node dist/cli.js launch

# 2) Set a wallpaper with Monet adaptation
node dist/cli.js apply "D:\pictures\wallpaper.jpg" --blur 6 --dim 30

# 3) (Recommended) Keep the theme alive + get the live settings panel.
#    --detach backgrounds it, so the panel keeps working after this shell
#    (or the agent session that started it) is gone.
node dist/cli.js serve --detach
```

With `serve` running, a 🎨 button appears in the bottom-right corner of ZCode. Open it to tune blur/dim live, cycle the framing mode (cover → contain → smart), toggle Monet colors or wallpaper translucency, swap the wallpaper image, or reset — everything previews instantly and is saved automatically. If the service is not running, the panel shows an explicit ⚠ offline banner instead of a zeroed configuration.

You can also just type `/beautify <image path>` in ZCode and let the agent do it, then say things like "make it blurrier" (handled by the `apply_options` MCP tool).

## CLI reference

| Command | Purpose |
|---|---|
| `launch [--port N]` | Start ZCode with `--remote-debugging-port` (quit ZCode first) |
| `apply <image> [--blur] [--dim] [--fit] [--no-monet]` | Set wallpaper + adapt colors (`--fit cover\|contain\|smart`) |
| `colors` | Re-apply the stored theme without changing the image |
| `serve [--detach] [--api-port M]` | Watch mode + settings panel + local control API (default API port 9223); `--detach` survives the shell that started it |
| `watch` | Headless watch mode: re-inject whenever ZCode restarts |
| `reset` | Remove wallpaper and color overrides |
| `status` | Show CDP reachability and renderer targets |

## MCP tools

| Tool | Purpose |
|---|---|
| `set_background` | Set wallpaper + Monet colors |
| `apply_options` | Tune blur/dim/monet/wallpaper visibility/framing without re-sending the image |
| `refresh_theme` | Re-inject the stored theme after a restart |
| `reset_appearance` | Remove wallpaper and overrides |
| `beautify_status` | Show the stored config |

## Project structure

```
├─ src/
│  ├─ cli.ts                 # CLI entry: launch / apply / colors / reset / status / watch / serve
│  ├─ core/
│  │  ├─ cdp.ts              # Minimal Chrome DevTools Protocol client + injection scripts
│  │  ├─ inject.ts           # Assembles the injected payload (wallpaper CSS + token overrides)
│  │  ├─ launch.ts           # Config persistence + ZCode launcher (single-instance aware)
│  │  ├─ monet.ts            # Image decode, MD3 source-color extraction, smart-fit analysis
│  │  ├─ server.ts           # `serve` mode: localhost control API + persistent injection sessions
│  │  ├─ session.ts          # Shared apply/reset operations used by CLI and MCP
│  │  └─ tokens.ts           # MD3 schemes → ZCode's Tailwind v4 --color-* variables
│  ├─ panel/panelScript.ts   # The injected settings panel (DOM + CSS + logic)
│  └─ mcp/server.ts          # MCP server exposing tools to the ZCode agent
├─ commands/beautify.md      # /beautify slash command
├─ skills/beautify/SKILL.md  # Agent-facing workflow documentation
├─ .zcode-plugin/plugin.json # ZCode plugin manifest (commands, skills, MCP server)
├─ marketplace.json          # Marketplace index so the repo is discoverable in ZCode
├─ scripts/bundle.mjs        # esbuild bundling (dist/ = self-contained, committed)
└─ dist/                     # Prebuilt cli.js + mcp/server.js — no build step needed
```

User data lives in `~/.zcode/cli/plugins/data/zcode-beautify/`: `config.json`
(live configuration), `config.backup.json` (what 还原/Reset remembers for
restore), and `wallpaper.*` (a copy of your image so the theme survives the
original file moving or being deleted).

## Development

```bash
npm install
npm run build    # type-check + compile to dist/
npm run bundle   # prebuilt single-file bundles (what the repo ships)
```

`dist/` is committed so users never need to build. If you change `src/`, run `npm run bundle` and commit the updated bundles.

## Skill pack (`skill-pack/`)

`skill-pack/` is a self-contained, platform-agnostic skill for AI coding agents
(Claude, DeepSeek, Codex, Doubao, …): hand the folder to any agent and it can
rebuild this beautify capability for **any** Electron app — the CDP plumbing,
MD3 color extraction, injection templates, live-tuning API, and the pitfall
list gathered from production. Versioned together with this repo. Grab it from
the [releases page](https://github.com/Logocceai/zcode-beautify/releases) as a
zip, or read [`skill-pack/SKILL.md`](skill-pack/SKILL.md) directly.

## Risks & limitations

- Injection happens over CDP — an **unofficial** mechanism. Updates to ZCode may break it; `reset` always restores the default look.
- `launch` restarts ZCode once. Without `serve`/`watch` running, the theme is lost on every ZCode restart (CDP sessions are scoped to the connection). No manual edits needed: the MCP server keeps every ZCode shortcut (desktop, start menu, taskbar) carrying ` --remote-debugging-port=9222` automatically, so the theme survives every restart as long as `serve` runs. Start it with `serve --detach`: a foreground `serve` dies with the terminal (or agent session) that spawned it, and the panel then reports itself offline.
- Functional colors (success/warning/destructive) are intentionally left untouched.
- The control API binds to `127.0.0.1` only and accepts requests from any local process by design (the injected panel needs CORS).

## License

MIT
