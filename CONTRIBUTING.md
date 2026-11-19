# Contributing

## Add or update a plugin

1. Publish a release as described in [README.md](README.md#publish-a-plugin).
2. Open a pull request that adds `plugins/<id>.toml` with `repo` and `description`. Use one plugin per PR.
3. If `plugin.toml` declares `net`, explain in the PR why the plugin needs each host.
4. Wait for the `check` workflow to pass. A maintainer then reviews and merges.

New releases need no PR; the daily index run picks them up. To change the description or repo, open a PR that edits the entry. To delist a plugin, open a PR that deletes it.

## Change the indexer

```sh
bun install
bun test
bunx tsc --noEmit
```

TypeScript is strict. zod checks every external input. Don't use `any`, non-null assertions or type assertions. Tests use fixture bytes built in memory and never touch the network.
