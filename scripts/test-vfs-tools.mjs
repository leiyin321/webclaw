import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

globalThis.indexedDB = createFakeIndexedDB();

const {
  runVirtualFileSystemShell,
  vfsCopy,
  vfsDelete,
  vfsDiff,
  vfsGlob,
  vfsHash,
  vfsList,
  vfsMkdir,
  vfsReadFile,
  vfsResolveDestination,
  vfsRestore,
  vfsStat,
  vfsTouch,
  vfsWriteFile
} = await import("../src/virtual-file-system.js");

await vfsMkdir("/workspace/tool-test", { parents: true });
await vfsWriteFile("/workspace/tool-test/a.txt", "alpha\nbeta\n", { createParents: true });
await vfsWriteFile("/workspace/tool-test/b.txt", "alpha\ngamma\n", { createParents: true });

const stat = await vfsStat("/workspace/tool-test/a.txt");
assert.equal(stat.entry.type, "file");
assert.equal(stat.entry.size, 11);

const glob = await vfsGlob("**/*.txt", { path: "/workspace/tool-test" });
assert.deepEqual(glob.matches.map((entry) => entry.path), [
  "/workspace/tool-test/a.txt",
  "/workspace/tool-test/b.txt"
]);

const hash = await vfsHash("/workspace/tool-test/a.txt");
assert.equal(hash.hash, createHash("sha256").update("alpha\nbeta\n").digest("hex"));

const diff = await vfsDiff("/workspace/tool-test/a.txt", "/workspace/tool-test/b.txt");
assert.equal(diff.identical, false);
assert.match(diff.diff, /-beta/);
assert.match(diff.diff, /\+gamma/);

await vfsCopy("/workspace/tool-test/a.txt", "/workspace/tool-test/copied.txt");
assert.equal((await vfsReadFile("/workspace/tool-test/copied.txt")).content, "alpha\nbeta\n");
await vfsMkdir("/workspace/tool-test/output");
assert.equal(
  await vfsResolveDestination("/workspace/tool-test/a.txt", "/workspace/tool-test/output"),
  "/workspace/tool-test/output/a.txt"
);

await vfsTouch("/workspace/tool-test/empty.txt");
assert.equal((await vfsStat("/workspace/tool-test/empty.txt")).entry.size, 0);
assert.equal((await runVirtualFileSystemShell("cd tool-test", { cwd: "/workspace" })).cwd, "/workspace/tool-test");

const trashed = await vfsDelete("/workspace/tool-test/copied.txt");
const trashPath = trashed.movedToTrash[0].to;
assert.match(trashPath, /^\/\.trash\//);
assert.equal((await vfsList("/.trash")).entries.length, 1);
await vfsRestore(trashPath, "/workspace/tool-test/restored.txt");
assert.equal((await vfsReadFile("/workspace/tool-test/restored.txt")).content, "alpha\nbeta\n");

console.log("VFS Tool tests passed.");
