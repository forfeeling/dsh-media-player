# dsh-media-player

Inline **video / animation player** for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI.

The harness attachment system only accepts `png/jpeg/webp/gif`, and its README
lists video support as deferred — so generated videos could not be played
inside the chat. This plugin closes that gap with two small halves:

- **Host half** — registers a `media_show` tool that mints a short-lived,
  opaque token URL for a local media file, plus a `/dsh-media` prefix route on
  the Web server that streams the bytes with HTTP **Range** support (the
  browser player can seek).
- **Client half** — a hand-authored browser bundle (no build step) that
  registers a keyed `tool.call.toolview` renderer, so `media_show` tool calls
  render as a native `<video controls>` / `<img>` card right in the chat flow.

```
agent calls media_show(path) ──▶ token URL minted (in-memory, dies with process)
        │                                  │
        ▼                                  ▼
tool-call event in session ──▶ client renderer ──▶ <video src="/dsh-media/<token>">
                                                               │
                                                               ▼
                                              webserver prefix route (Range-aware)
```

## Security posture

- The route **never accepts paths** — only random 96-bit tokens minted by the
  tool, each bound to one absolute path at mint time. No directory listing, no
  traversal surface.
- Tokens are in-memory only; a server restart invalidates them (the player
  then shows a clean 404 and the agent can re-mint).
- `cache-control: no-store` on every media response.

## Install

The plugin is a Cordis loader entry with a `dsh.client` browser bundle.

1. Clone anywhere, e.g. `git clone https://github.com/<you>/dsh-media-player ~/dsh-media-player`.
2. Link it into your Web profile so the bare specifier resolves:

   ```bash
   ln -s ~/dsh-media-player "$HOME/.dsh/profiles/web/node_modules/dsh-media-player"
   ```

   (its only runtime dep, `@deepseek-ai/dsh-tools`, is symlinked the same way
   from your dsh runtime store — see `scripts/link-deps.sh`)
3. Enable it in `$HOME/.dsh/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: dsh-media-player
         name: dsh-media-player
   ```

4. **Restart `dsh web`** — client-package metadata is cached per name for the
   life of the process, so plugin-set changes need a restart (bundle *content*
   changes of an already-known package ride the HMR chain instead).
5. Refresh the GUI. New chat sessions now expose `media_show`.

## Usage

In any new chat session:

> 把 ./out.mp4 打开看看 / show me the video at ./out.mp4

The agent calls `media_show` and the conversation shows a native player card:

```jsonc
// tool result
{ "url": "/dsh-media/582e7e5a001f0ef59f18a947",
  "kind": "video", "mime": "video/mp4",
  "bytes": 7938745, "path": "/abs/path/out.mp4", "label": "optional caption" }
```

Supported extensions: `mp4 webm mov m4v mkv gif webp png jpg jpeg`
(video kinds render `<video controls playsInline>`, image kinds `<img>`).

## Development

```bash
node test/unit.mjs          # host + client unit validation (needs ffmpeg for the fallback clip)
```

The suite stubs the Cordis context (tool registry, prompt sections, webserver
route table) and the browser module loader, then asserts: minting, error
paths, 200/206/416/404 route behavior, `output.render` shape, toolview
registration and the rendered element tree.

### Why the client bundle is hand-written

DSH client bundles are classic scripts of the form
`window.__ModuleLoader__.load({ id, factory })` where `factory(require)`
receives the shell's `require` (seed words like `react`). The component here is
small enough to author directly in `React.createElement` form — no bundler, no
JSX, no build step to forget.

### Gotchas learned the hard way

- Cordis `inject` is a **service-name array** (`["tools", "systemPrompt",
  "webServer"]`); accessing an undeclared service throws at apply.
- Webserver prefix routes match `pathname.startsWith(prefix + "/")` — register
  **without** a trailing slash.
- Loader entry `name` must be a package specifier resolvable from the profile
  root (CJS resolution of `<spec>/package.json`), not a file path.

## License

MIT
