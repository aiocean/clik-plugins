## Plugin

- Entry: `plugins/<id>.toml`
- Repository:
- What it does:

## Network

<!-- If plugin.toml has `net`, list each host and why the plugin needs it. Otherwise write "none". -->

## Checklist

- [ ] The filename equals `id` in `plugin.toml`.
- [ ] The latest release has exactly one asset, named `<id>-<version>.clikplugin.tar.gz`.
- [ ] The package holds `plugin.toml` and `plugin.wasm` (and optionally `icons/*.svg`), is 25 MB or less, and has no symlinks.
- [ ] `description` is one line.
- [ ] The repository is public and its README says what the plugin does.
- [ ] Every `net` host is explained above.
