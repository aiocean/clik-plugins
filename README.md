# clik plugins

This is the list of community plugins for [clik](https://clik.aiocean.io), the macOS screenshot app. clik reads `index.json` from this repository. Each plugin lives in its author's own GitHub repository. This repository only lists them.

## What a plugin is

A clik plugin is a WebAssembly component that clik runs in a sandbox. It can't read your files, run programs or open windows. It sees only the image and shapes clik passes to it. A plugin provides one or more steps:

| Role | What it does |
|---|---|
| `filter` | Changes the image or shapes (pixelate, recolor, crop). |
| `sink` | Sends the capture somewhere (upload, post to a tracker). It may return a URL, which clik copies to the clipboard. |
| `shape` | Draws a new shape kind on the canvas (badge, callout). |

A plugin gets network access only for the hostnames it lists in `net`. clik shows those hosts to you before you install, and blocks every other host.

## Install a plugin

Open clik **Settings → Plugins**. You can then:

- choose **Browse** and pick a plugin from this list, or
- paste `owner/repo` into **Install from GitHub** to install a plugin that isn't listed here.

## Publish a plugin

1. Write `plugin.toml`:

   ```toml
   id = "pixel"            # a-z, 0-9 and -; it must match your registry entry
   name = "Pixel"
   version = "1.2.0"       # semver
   api = 1
   net = []                # hostnames fetch may reach, e.g. ["api.linear.app"]

   [[steps]]
   name = "pixelate"
   label = "Pixelate"
   role = "filter"         # filter | sink | shape
   ```

   You can also add `needs_render`, `icon` and `[[steps.props]]` (shape props), plus `[[config]]` for user settings such as API keys. Unknown fields are an error.

2. Build a WebAssembly component (no WASI) against the `clik-plugin` SDK, api 1.

3. Publish a GitHub release with **exactly one** asset named `<id>-<version>.clikplugin.tar.gz`. The archive is a gzip-compressed tar holding:

   ```
   plugin.toml
   plugin.wasm
   icons/*.svg      (optional)
   ```

   Put the files at the root of the archive or in one top-level folder. The archive must be 25 MB or less and hold only regular files and folders: no symlinks, no `..`. If you build it on macOS, set `COPYFILE_DISABLE=1`; without it, tar adds `._*` metadata files and the package is rejected.

   This workflow builds and publishes a release when you push a tag such as `v1.2.0`. Put it at `.github/workflows/release.yml`:

   ```yaml
   name: release
   on:
     push:
       tags: ["v*"]
   permissions:
     contents: write
   jobs:
     release:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v7
         - uses: dtolnay/rust-toolchain@stable
           with:
             targets: wasm32-unknown-unknown
         - run: cargo install --locked wasm-tools
         - name: Build
           run: |
             cargo build --release --target wasm32-unknown-unknown
             crate=$(cargo metadata --no-deps --format-version 1 | jq -r '.packages[0].name | gsub("-"; "_")')
             wasm-tools component new "target/wasm32-unknown-unknown/release/$crate.wasm" -o plugin.wasm
         - name: Package
           run: |
             id=$(sed -n 's/^id = "\(.*\)"/\1/p' plugin.toml)
             version=$(sed -n 's/^version = "\(.*\)"/\1/p' plugin.toml)
             [ "v$version" = "$GITHUB_REF_NAME" ] || { echo "tag $GITHUB_REF_NAME does not match version $version"; exit 1; }
             mkdir pkg && cp plugin.toml plugin.wasm pkg/
             if [ -d icons ]; then cp -R icons pkg/; fi
             tar -czf "$id-$version.clikplugin.tar.gz" -C pkg .
             echo "ASSET=$id-$version.clikplugin.tar.gz" >> "$GITHUB_ENV"
         - run: gh release create "$GITHUB_REF_NAME" "$ASSET" --title "$GITHUB_REF_NAME" --notes ""
           env:
             GH_TOKEN: ${{ github.token }}
   ```

   To check a package before you release it, clone this repository and run `bun install && bun src/cli.ts inspect path/to/<id>-<version>.clikplugin.tar.gz`.

## Submit a plugin

Open a pull request that adds `plugins/<id>.toml`:

```toml
repo = "your-name/clik-pixel"
description = "Pixelate any region of a screenshot"
```

- The filename is the plugin id. It must equal `id` in your `plugin.toml`.
- `description` is one line of 140 characters or less.
- `clik` is reserved for the plugins bundled with the app.

CI downloads your latest release and checks it. After the PR is merged, the index picks up your plugin within minutes. When you publish a new release, the daily index run picks it up. You don't need another PR.

## Review rules

Maintainers check every submission before they merge it:

- **Sandbox.** The plugin is a WASM component. It can reach the host only through clik's imports (`log`, `progress`, `config`, `fetch`).
- **Network.** Every host in `net` is shown to users before they install. If your plugin declares `net`, the PR must explain why it needs each host. Hosts that the plugin's purpose doesn't explain are rejected.
- **Source.** The repository is public, and its README says what the plugin does.
- **Working release.** CI passes on the latest release.

A listed plugin is removed when its repository or release disappears, or when it breaks these rules.

## How the index is built

`bun run index` reads `plugins/*.toml`. For each entry it fetches the latest release, checks the package and writes `index.json`, sorted by id. A plugin whose release is broken is left out and reported. GitHub Actions runs it on every merge to `main`, once a day, and on demand. It commits `index.json` only when the content changed.

```sh
bun install
bun test
bun run check [ids...]   # what CI runs on pull requests
bun run index
```

## License

MIT
