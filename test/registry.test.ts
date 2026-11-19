import { describe, expect, test } from "bun:test";
import { parseEntry, registryErrors } from "../src/entry.ts";
import { CheckError } from "../src/errors.ts";
import { parseManifest } from "../src/manifest.ts";
import { MAX_PACKAGE_BYTES, readPackage } from "../src/package.ts";
import { describePackage, pickAsset } from "../src/plugin.ts";
import { readTar } from "../src/tar.ts";
import { MANIFEST, paxPath, tar, tarGz, WASM } from "./tarball.ts";

const entry = { id: "pixel", repo: "someone/clik-pixel", description: "Pixelate a region" };
const asset = (name: string) => ({ name, browser_download_url: `https://github.com/someone/clik-pixel/releases/download/v1.2.0/${name}`, size: 1 });

describe("tar", () => {
  test("reads files at the root, with ./ prefixes and directory entries", () => {
    const files = readTar(tar([{ path: "./", type: "5" }, { path: "./icons/", type: "5" }, { path: "./icons/a.svg", data: "<svg/>" }, { path: "plugin.toml", data: "x" }]));
    expect(files.map((f) => f.path)).toEqual(["icons/a.svg", "plugin.toml"]);
  });

  test("applies pax path headers", () => {
    const long = `${"d".repeat(120)}/plugin.toml`;
    expect(readTar(tar([paxPath(long), { path: "short", data: "x" }])).map((f) => f.path)).toEqual([long]);
  });

  test.each([
    [{ path: "link", type: "2", linkname: "/etc/passwd" }, "not a regular file"],
    [{ path: "hard", type: "1", linkname: "plugin.toml" }, "not a regular file"],
    [{ path: "../evil", data: "x" }, "unsafe path"],
    [{ path: "a/../../evil", data: "x" }, "unsafe path"],
    [{ path: "/etc/evil", data: "x" }, "absolute path"],
  ])("rejects %o", (bad, reason) => {
    expect(() => readTar(tar([bad]))).toThrow(reason);
  });

  test("ignores binary pax values such as macOS xattrs", () => {
    const record = new Uint8Array([...new TextEncoder().encode("30 SCHILY.xattr.com.apple.x="), 0xff, 0x0a]);
    expect(readTar(tar([{ path: "PaxHeader", type: "x", data: record }, { path: "plugin.toml", data: "x" }])).map((f) => f.path)).toEqual(["plugin.toml"]);
  });

  test("rejects a pax header that smuggles ..", () => {
    expect(() => readTar(tar([paxPath("../evil"), { path: "ok", data: "x" }]))).toThrow("unsafe path");
  });

  test("rejects a corrupted header", () => {
    const bytes = tar([{ path: "plugin.toml", data: "x" }]);
    bytes[0] = 0x41;
    expect(() => readTar(bytes)).toThrow("bad checksum");
  });

  test("rejects duplicate paths", () => {
    expect(() => readTar(tar([{ path: "a", data: "1" }, { path: "./a", data: "2" }]))).toThrow("twice");
  });
});

describe("package", () => {
  test("reads plugin.toml at the root", () => {
    const pkg = readPackage(tarGz([{ path: "plugin.toml", data: MANIFEST }, { path: "plugin.wasm", data: WASM }]));
    expect(pkg.manifestToml).toBe(MANIFEST);
  });

  test("reads plugin.toml inside one top-level folder", () => {
    const pkg = readPackage(tarGz([{ path: "pixel/plugin.toml", data: MANIFEST }, { path: "pixel/plugin.wasm", data: WASM }]));
    expect(pkg.wasm).toEqual(WASM);
  });

  test("rejects two top-level folders, a missing wasm, a non-wasm and non-gzip bytes", () => {
    expect(() => readPackage(tarGz([{ path: "a/plugin.toml", data: MANIFEST }, { path: "b/plugin.wasm", data: WASM }]))).toThrow("one top-level folder");
    expect(() => readPackage(tarGz([{ path: "plugin.toml", data: MANIFEST }]))).toThrow("no plugin.wasm");
    expect(() => readPackage(tarGz([{ path: "plugin.toml", data: MANIFEST }, { path: "plugin.wasm", data: "MZ" }]))).toThrow("not a WebAssembly");
    expect(() => readPackage(new TextEncoder().encode("hello"))).toThrow("not a valid gzip");
    expect(() => readPackage(tarGz([{ path: "plugin.toml", data: MANIFEST }, { path: "plugin.wasm", data: WASM }, { path: "._plugin.toml", data: "x" }]))).toThrow("COPYFILE_DISABLE");
  });

  test("rejects a package over the size limit", () => {
    expect(() => readPackage(new Uint8Array(MAX_PACKAGE_BYTES + 1))).toThrow("limit");
  });
});

describe("manifest", () => {
  test("parses steps, labels and net", () => {
    const m = parseManifest(MANIFEST);
    expect(m).toEqual({
      id: "pixel",
      name: "Pixel",
      version: "1.2.0",
      api: 1,
      net: ["api.example.com"],
      steps: [
        { name: "pixelate", label: "Pixelate", role: "filter" },
        { name: "badge", label: "badge", role: "shape" },
      ],
    });
  });

  test.each([
    ["api = 1", "api = 2", "unsupported api 2"],
    ['id = "pixel"', 'id = "Pixel"', "may contain only"],
    ['id = "pixel"', 'id = ""', "id is empty"],
    ['version = "1.2.0"', 'version = "1.2"', "semver"],
    ['net = ["api.example.com"]', 'net = ["https://api.example.com"]', "bare hostname"],
    ['role = "filter"', 'role = "magic"', "invalid plugin.toml"],
    ["default = 0xFF3B30FF", 'default = "red"', "0xRRGGBBAA"],
    ['name = "Pixel"', 'name = "Pixel"\nextra = true', "invalid plugin.toml"],
    ['name = "badge"', 'name = "pixelate"', "declared twice"],
  ])("rejects %s -> %s", (from, to, reason) => {
    expect(() => parseManifest(MANIFEST.replace(from, to))).toThrow(reason);
  });
});

describe("entry", () => {
  test("parses a valid entry", () => {
    expect(parseEntry("pixel.toml", 'repo = "someone/clik-pixel"\ndescription = "Pixelate a region"\n')).toEqual(entry);
  });

  test.each([
    ["Pixel.toml", 'repo = "a/b"\ndescription = "d"', "may contain only"],
    ["clik.toml", 'repo = "a/b"\ndescription = "d"', "reserved"],
    ["notes.md", "", "only <id>.toml"],
    ["p.toml", 'repo = "https://github.com/a/b"\ndescription = "d"', "owner/name"],
    ["p.toml", 'repo = "a/b"\ndescription = ""', "must not be empty"],
    ["p.toml", 'repo = "a/b"\ndescription = "d"\nhomepage = "x"', "Unrecognized key"],
    ["p.toml", 'repo = "a/b"', "description"],
  ])("rejects %s", (file, text, reason) => {
    expect(() => parseEntry(file, text)).toThrow(reason);
  });

  test("reports a repo listed twice, case-insensitively", () => {
    expect(registryErrors([entry, { ...entry, id: "pixel2", repo: "Someone/Clik-Pixel" }])).toEqual([
      "plugins/pixel2.toml: repo Someone/Clik-Pixel is already listed by plugins/pixel.toml",
    ]);
  });
});

describe("index record", () => {
  const bytes = tarGz([{ path: "plugin.toml", data: MANIFEST }, { path: "plugin.wasm", data: WASM }]);

  test("describes a valid package", () => {
    const p = describePackage(entry, "v1.2.0", asset("pixel-1.2.0.clikplugin.tar.gz"), bytes);
    expect(p.sha256).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    expect(p.size).toBe(bytes.length);
    expect(p.net).toEqual(["api.example.com"]);
  });

  test("rejects an id that does not match the entry, a bundled id and a misnamed asset", () => {
    expect(() => describePackage({ ...entry, id: "other" }, "v1", asset("pixel-1.2.0.clikplugin.tar.gz"), bytes)).toThrow("but the entry is");
    const clik = tarGz([{ path: "plugin.toml", data: MANIFEST.replace('id = "pixel"', 'id = "clik"') }, { path: "plugin.wasm", data: WASM }]);
    expect(() => describePackage({ ...entry, id: "clik" }, "v1", asset("clik-1.2.0.clikplugin.tar.gz"), clik)).toThrow("reserved");
    expect(() => describePackage(entry, "v1", asset("pixel.clikplugin.tar.gz"), bytes)).toThrow("should be pixel-1.2.0.clikplugin.tar.gz");
  });

  test("picks exactly one package asset", () => {
    const release = (names: string[]) => ({ tag_name: "v1", assets: names.map(asset) });
    expect(pickAsset(release(["notes.txt", "pixel-1.2.0.clikplugin.tar.gz"])).name).toBe("pixel-1.2.0.clikplugin.tar.gz");
    expect(() => pickAsset(release(["notes.txt"]))).toThrow(CheckError);
    expect(() => pickAsset(release(["a.clikplugin.tar.gz", "b.clikplugin.tar.gz"]))).toThrow("exactly one");
  });
});
