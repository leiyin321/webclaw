const DB_NAME = "webclaw-vfs";
const DB_VERSION = 2;
const ENTRY_STORE = "entries";
const CONTENT_STORE = "contents";
const TRASH_STORE = "trash";
const DEFAULT_DIRECTORIES = ["/", "/workspace", "/workspace/knowledge", "/workspace/memory", "/inbox", "/uploads", "/exports", "/skills", "/cache", "/.trash"];
const MAX_CAT_BYTES = 100_000;
const MAX_TOOL_READ_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 500_000;
const MAX_SEARCH_RESULTS = 100;

export class VirtualFileSystemError extends Error {
  constructor(message) {
    super(message);
    this.name = "VirtualFileSystemError";
  }
}

export async function runVirtualFileSystemShell(command, { cwd = "/workspace" } = {}) {
  const tokens = tokenizeCommand(command);
  if (!tokens.length) throw new VirtualFileSystemError("command is required.");
  const [name, ...args] = tokens;
  const currentDirectory = normalizePath(cwd, "/");
  await ensureFileSystem();

  switch (name) {
    case "pwd":
      requireArgCount(name, args, 0, 0);
      return { command: name, cwd: currentDirectory, output: currentDirectory };
    case "cd": {
      requireArgCount(name, args, 0, 1);
      const target = resolvePath(args[0] || ".", currentDirectory);
      const entry = await getEntry(target);
      if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${target}`);
      if (entry.type !== "directory") throw new VirtualFileSystemError(`Not a directory: ${target}`);
      return { command: name, cwd: target, output: target };
    }
    case "ls":
      return listCommand(args, currentDirectory);
    case "stat":
      return statCommand(args, currentDirectory);
    case "mkdir":
      return mkdirCommand(args, currentDirectory);
    case "touch":
      return touchCommand(args, currentDirectory);
    case "cat":
      return catCommand(args, currentDirectory);
    case "cp":
      return copyCommand(args, currentDirectory);
    case "mv":
      return moveCommand(args, currentDirectory);
    case "rm":
      return removeCommand(args, currentDirectory);
    default:
      throw new VirtualFileSystemError(`Unsupported virtual filesystem command: ${name}. Allowed commands: pwd, cd, ls, stat, mkdir, touch, cat, cp, mv, rm.`);
  }
}

export async function vfsList(path = "/") {
  await ensureFileSystem();
  const normalizedPath = normalizePath(path, "/");
  const entry = await getEntry(normalizedPath);
  if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${normalizedPath}`);
  const entries = entry.type === "directory" ? (await listEntries(normalizedPath)).map(publicEntry) : [];
  if (normalizedPath === "/.trash") {
    for (const item of entries) item.trash = await getTrashRecord(item.path);
  }
  return {
    path: normalizedPath,
    entry: publicEntry(entry),
    entries
  };
}

export async function vfsReadFile(path, { startLine, endLine, maxChars = 60_000, includeData = false } = {}) {
  await ensureFileSystem();
  const normalizedPath = normalizePath(path, "/");
  assertNotTrashPath(normalizedPath, "read");
  const entry = await requireFile(normalizedPath);
  const blob = (await getContent(normalizedPath)) || new Blob([""]);
  const isText = isTextMimeType(entry.mimeType) || !entry.mimeType;
  const result = { path: normalizedPath, entry: publicEntry(entry), isText };
  if (isText) {
    const text = await blob.text();
    const lines = text.split("\n");
    const from = clampLine(startLine, 1, lines.length || 1);
    const to = endLine === undefined || endLine === null || endLine === ""
      ? lines.length
      : clampLine(endLine, from, lines.length || from);
    const selected = lines.slice(from - 1, to).join("\n");
    const limit = clampNumber(maxChars, 1000, 200_000, 60_000);
    result.content = selected.slice(0, limit);
    result.startLine = from;
    result.endLine = to;
    result.truncated = selected.length > limit;
    result.totalLines = lines.length;
    return result;
  }
  result.size = blob.size;
  result.contentAvailable = blob.size <= MAX_TOOL_READ_BYTES;
  if (includeData && blob.size <= MAX_TOOL_READ_BYTES) result.dataUrl = await blobToDataUrl(blob);
  return result;
}

export async function vfsWriteFile(path, content, { mimeType = "text/plain", expectedVersion, createParents = false } = {}) {
  await ensureFileSystem();
  const normalizedPath = normalizePath(path, "/");
  assertNotTrashPath(normalizedPath, "write");
  if (normalizedPath === "/") throw new VirtualFileSystemError("Cannot write to the filesystem root.");
  const blob = content instanceof Blob ? content : new Blob([String(content ?? "")], { type: mimeType || "text/plain" });
  return writeBlob(normalizedPath, blob, { mimeType, expectedVersion, createParents });
}

export async function vfsEditFile(path, { oldText, newText, expectedVersion, replaceAll = false } = {}) {
  if (typeof oldText !== "string" || !oldText) throw new VirtualFileSystemError("oldText is required.");
  if (typeof newText !== "string") throw new VirtualFileSystemError("newText is required.");
  const normalizedPath = normalizePath(path, "/");
  assertNotTrashPath(normalizedPath, "edit");
  const entry = await requireFile(normalizedPath);
  if (!isTextMimeType(entry.mimeType)) throw new VirtualFileSystemError("fs_edit only supports text files.");
  if (entry.size > 500_000) throw new VirtualFileSystemError("File is too large for fs_edit. Use a smaller patch or a ranged editing workflow.");
  const content = await ((await getContent(normalizedPath)) || new Blob([""])).text();
  const occurrences = countOccurrences(content, oldText);
  if (!occurrences) throw new VirtualFileSystemError("oldText was not found. Read the file again before editing.");
  if (!replaceAll && occurrences !== 1) throw new VirtualFileSystemError(`oldText matched ${occurrences} locations. Use more context or set replaceAll explicitly.`);
  const updated = replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText);
  return vfsWriteFile(normalizedPath, updated, { mimeType: entry.mimeType, expectedVersion: expectedVersion ?? entry.version });
}

export async function vfsSearch(query, { path = "/", maxResults = 30 } = {}) {
  await ensureFileSystem();
  const needle = String(query || "").trim();
  if (!needle) throw new VirtualFileSystemError("query is required.");
  const root = normalizePath(path, "/");
  if (isTrashPath(root)) throw new VirtualFileSystemError("Trash items can only be restored or permanently deleted.");
  const rootEntry = await getEntry(root);
  if (!rootEntry) throw new VirtualFileSystemError(`No such file or directory: ${root}`);
  const files = (rootEntry.type === "file" ? [rootEntry] : (await descendantsOf(root)).filter((entry) => entry.type === "file"))
    .filter((entry) => !isTrashPath(entry.path));
  const limit = clampNumber(maxResults, 1, MAX_SEARCH_RESULTS, 30);
  const lowerNeedle = needle.toLowerCase();
  const matches = [];
  for (const entry of files) {
    if (!isTextMimeType(entry.mimeType) || entry.size > MAX_SEARCH_FILE_BYTES) continue;
    const text = await ((await getContent(entry.path)) || new Blob([""])).text();
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(lowerNeedle)) continue;
      matches.push({ path: entry.path, line: index + 1, text: lines[index].slice(0, 500) });
      if (matches.length >= limit) return { query: needle, path: root, matches, truncated: true };
    }
  }
  return { query: needle, path: root, matches, truncated: false };
}

export async function vfsMkdir(path, { parents = false } = {}) {
  assertNotTrashPath(normalizePath(path, "/"), "create directories in");
  const command = parents ? `mkdir -p ${quoteShellPath(path)}` : `mkdir ${quoteShellPath(path)}`;
  return runVirtualFileSystemShell(command, { cwd: "/" });
}

export async function vfsMove(source, destination) {
  assertNotTrashPath(normalizePath(source, "/"), "move");
  assertNotTrashPath(normalizePath(destination, "/"), "move items into");
  return runVirtualFileSystemShell(`mv ${quoteShellPath(source)} ${quoteShellPath(destination)}`, { cwd: "/" });
}

export async function vfsDelete(path, { recursive = true } = {}) {
  assertNotTrashPath(normalizePath(path, "/"), "delete");
  return runVirtualFileSystemShell(`${recursive ? "rm -r" : "rm"} ${quoteShellPath(path)}`, { cwd: "/" });
}

export async function vfsRestore(trashPath, destination, { onConflict = "error", confirmOverwrite = false } = {}) {
  const source = normalizePath(trashPath, "/");
  if (parentPath(source) !== "/.trash") throw new VirtualFileSystemError("Only top-level entries in /.trash can be restored.");
  const record = await getTrashRecord(source);
  let target = normalizePath(destination || record?.originalPath || `/workspace/${baseName(source).replace(/^\d+-[\w-]+-/, "")}`, "/");
  const existing = await getEntry(target);
  const conflict = String(onConflict || "error");
  if (existing) {
    if (conflict === "rename") {
      target = await nextAvailablePath(target);
    } else if (conflict === "overwrite" && confirmOverwrite) {
      await moveToTrash(target, true);
    } else {
      throw new VirtualFileSystemError(`Restore destination already exists: ${target}. Use onConflict=rename, or onConflict=overwrite with confirmOverwrite=true.`);
    }
  }
  await ensureParentDirectory(target);
  await moveTree(source, target);
  await deleteTrashRecord(source);
  return { ok: true, restoredFrom: source, destination: target, originalPath: record?.originalPath || "", conflict };
}

export async function vfsPurge(path, { recursive = true } = {}) {
  await ensureFileSystem();
  const source = normalizePath(path, "/");
  if (parentPath(source) !== "/.trash") throw new VirtualFileSystemError("Permanent deletion is only allowed for top-level entries in /.trash.");
  const entry = await getEntry(source);
  if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${source}`);
  if (entry.type === "directory" && (await listEntries(source)).length && !recursive) {
    throw new VirtualFileSystemError(`Cannot permanently delete non-empty directory without recursive=true: ${source}`);
  }
  await purgeTree(source);
  return { ok: true, purged: source };
}

export async function vfsEmptyTrash() {
  await ensureFileSystem();
  const entries = await listEntries("/.trash");
  for (const entry of entries) await purgeTree(entry.path);
  return { ok: true, purgedCount: entries.length };
}

export async function vfsGetFileBlob(path) {
  await ensureFileSystem();
  const normalizedPath = normalizePath(path, "/");
  assertNotTrashPath(normalizedPath, "read");
  await requireFile(normalizedPath);
  return (await getContent(normalizedPath)) || new Blob([""]);
}

export async function vfsGetUsage() {
  await ensureFileSystem();
  const entries = await allEntries();
  const files = entries.filter((entry) => entry.type === "file");
  let estimate = null;
  try {
    if (navigator.storage?.estimate) estimate = await navigator.storage.estimate();
  } catch {
    // Storage estimates are optional and do not affect virtual filesystem access.
  }
  return {
    files: files.length,
    directories: entries.length - files.length,
    bytes: files.reduce((total, entry) => total + Number(entry.size || 0), 0),
    quota: Number(estimate?.quota || 0),
    usage: Number(estimate?.usage || 0)
  };
}

export async function vfsApplyPatch(operations) {
  const normalized = Array.isArray(operations) ? operations : [];
  if (!normalized.length) throw new VirtualFileSystemError("operations is required.");
  if (normalized.length > 30) throw new VirtualFileSystemError("A patch may contain at most 30 operations.");
  for (const operation of normalized) validatePatchOperation(operation);
  const results = [];
  for (const operation of normalized) {
    switch (operation.op) {
      case "mkdir":
        results.push(await vfsMkdir(operation.path, { parents: operation.parents === true }));
        break;
      case "write":
        results.push(await vfsWriteFile(operation.path, operation.content ?? "", operation));
        break;
      case "edit":
        results.push(await vfsEditFile(operation.path, operation));
        break;
      case "move":
        results.push(await vfsMove(operation.from, operation.to));
        break;
      case "delete":
        results.push(await vfsDelete(operation.path, { recursive: operation.recursive !== false }));
        break;
      default:
        throw new VirtualFileSystemError(`Unsupported patch operation: ${operation.op}`);
    }
  }
  return { ok: true, operations: results };
}

function validatePatchOperation(operation) {
  if (!operation || typeof operation !== "object") throw new VirtualFileSystemError("Each patch operation must be an object.");
  const op = String(operation.op || "");
  if (!["mkdir", "write", "edit", "move", "delete"].includes(op)) {
    throw new VirtualFileSystemError(`Unsupported patch operation: ${op}`);
  }
  if (op === "move") {
    if (!operation.from || !operation.to) throw new VirtualFileSystemError("move requires from and to.");
    return;
  }
  if (!operation.path) throw new VirtualFileSystemError(`${op} requires path.`);
  if (op === "edit" && !operation.oldText) throw new VirtualFileSystemError("edit requires oldText.");
}

async function writeBlob(path, blob, { mimeType, expectedVersion, createParents }) {
  if (createParents) await ensureDirectoryPath(parentPath(path));
  else await ensureParentDirectory(path);
  const existing = await getEntry(path);
  if (existing?.type === "directory") throw new VirtualFileSystemError(`Cannot write to directory: ${path}`);
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== Number(existing?.version || 0)) {
    throw new VirtualFileSystemError(`Version conflict for ${path}. Expected ${expectedVersion}, current version is ${existing?.version || 0}.`);
  }
  const now = Date.now();
  const entry = {
    ...(existing || newFile(path)),
    path,
    type: "file",
    size: blob.size,
    mimeType: inferMimeType(path, mimeType || blob.type || existing?.mimeType),
    updatedAt: now,
    version: Number(existing?.version || 0) + 1
  };
  const db = await openDatabase();
  const transaction = db.transaction([ENTRY_STORE, CONTENT_STORE], "readwrite");
  transaction.objectStore(ENTRY_STORE).put(entry);
  transaction.objectStore(CONTENT_STORE).put({ path, blob });
  await transactionDone(transaction);
  return { ok: true, path, entry: publicEntry(entry), created: !existing };
}

async function requireFile(path) {
  const entry = await getEntry(path);
  if (!entry) throw new VirtualFileSystemError(`No such file: ${path}`);
  if (entry.type !== "file") throw new VirtualFileSystemError(`Expected a file but found a directory: ${path}`);
  return entry;
}

function isTextMimeType(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  return !type || type.startsWith("text/") || /(?:json|xml|javascript|typescript|yaml|toml|csv|markdown|sql|graphql)/.test(type);
}

function inferMimeType(path, value) {
  const requested = String(value || "").toLowerCase();
  if (requested && requested !== "application/octet-stream") return requested;
  const extension = baseName(path).split(".").pop()?.toLowerCase() || "";
  if (["txt", "md", "markdown", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "yaml", "yml", "toml", "csv", "html", "htm", "css", "xml", "sql", "py", "sh"].includes(extension)) {
    return extension === "json" ? "application/json" : extension === "csv" ? "text/csv" : "text/plain";
  }
  return requested || "application/octet-stream";
}

function clampLine(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(number)));
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function countOccurrences(text, search) {
  let from = 0;
  let count = 0;
  while (true) {
    const index = text.indexOf(search, from);
    if (index < 0) return count;
    count += 1;
    from = index + search.length;
  }
}

function quoteShellPath(path) {
  return `"${String(path || "").replace(/[\\"]/g, "\\$&")}"`;
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
  });
}

async function listCommand(rawArgs, cwd) {
  const { flags, args } = parseFlags(rawArgs, new Set(["-l"]));
  requireArgCount("ls", args, 0, 1);
  const path = resolvePath(args[0] || ".", cwd);
  const entry = await getEntry(path);
  if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${path}`);
  if (entry.type === "file") return { command: "ls", path, entries: [publicEntry(entry)] };
  const entries = (await listEntries(path)).map(publicEntry);
  return { command: "ls", path, long: flags.has("-l"), entries };
}

async function statCommand(args, cwd) {
  requireArgCount("stat", args, 1, 1);
  const path = resolvePath(args[0], cwd);
  const entry = await getEntry(path);
  if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${path}`);
  return { command: "stat", entry: publicEntry(entry) };
}

async function mkdirCommand(rawArgs, cwd) {
  const { flags, args } = parseFlags(rawArgs, new Set(["-p"]));
  requireArgCount("mkdir", args, 1);
  const created = [];
  for (const value of args) {
    const path = resolvePath(value, cwd);
    assertNotTrashPath(path, "create directories in");
    if (path === "/") continue;
    const existing = await getEntry(path);
    if (existing) {
      if (existing.type !== "directory") throw new VirtualFileSystemError(`Cannot create directory '${path}': a file exists at this path.`);
      if (!flags.has("-p")) throw new VirtualFileSystemError(`Directory already exists: ${path}`);
      continue;
    }
    if (flags.has("-p")) {
      const made = await ensureDirectoryPath(path);
      created.push(...made);
    } else {
      await ensureParentDirectory(path);
      await putEntry(newDirectory(path));
      created.push(path);
    }
  }
  return { command: "mkdir", created: unique(created) };
}

async function touchCommand(args, cwd) {
  requireArgCount("touch", args, 1);
  const touched = [];
  for (const value of args) {
    const path = resolvePath(value, cwd);
    assertNotTrashPath(path, "write");
    if (path === "/") throw new VirtualFileSystemError("Cannot touch the filesystem root.");
    await ensureParentDirectory(path);
    const existing = await getEntry(path);
    if (existing?.type === "directory") throw new VirtualFileSystemError(`Cannot touch directory: ${path}`);
    const now = Date.now();
    if (existing) {
      await putEntry({ ...existing, updatedAt: now, version: Number(existing.version || 0) + 1 });
    } else {
      await putEntry(newFile(path));
      await putContent(path, new Blob([""]));
    }
    touched.push(path);
  }
  return { command: "touch", touched };
}

async function catCommand(args, cwd) {
  requireArgCount("cat", args, 1);
  const files = [];
  for (const value of args) {
    const path = resolvePath(value, cwd);
    assertNotTrashPath(path, "read");
    const entry = await getEntry(path);
    if (!entry) throw new VirtualFileSystemError(`No such file: ${path}`);
    if (entry.type !== "file") throw new VirtualFileSystemError(`Cannot cat a directory: ${path}`);
    if (entry.size > MAX_CAT_BYTES) throw new VirtualFileSystemError(`File is too large to display (${entry.size} bytes). Use a ranged file read tool instead.`);
    const content = await getContent(path);
    files.push({ path, content: content ? await content.text() : "" });
  }
  return { command: "cat", files };
}

async function copyCommand(args, cwd) {
  requireArgCount("cp", args, 2, 2);
  const source = resolvePath(args[0], cwd);
  assertNotTrashPath(source, "copy");
  const destination = await resolveDestination(source, args[1], cwd);
  assertNotTrashPath(destination, "copy items into");
  await copyTree(source, destination);
  return { command: "cp", source, destination };
}

async function moveCommand(args, cwd) {
  requireArgCount("mv", args, 2, 2);
  const source = resolvePath(args[0], cwd);
  assertNotTrashPath(source, "move");
  if (source === "/") throw new VirtualFileSystemError("Cannot move the filesystem root.");
  const destination = await resolveDestination(source, args[1], cwd);
  assertNotTrashPath(destination, "move items into");
  if (destination === source) return { command: "mv", source, destination, unchanged: true };
  if (destination.startsWith(`${source}/`)) throw new VirtualFileSystemError("Cannot move a directory into itself.");
  await moveTree(source, destination);
  return { command: "mv", source, destination };
}

async function removeCommand(rawArgs, cwd) {
  const { flags, args } = parseFlags(rawArgs, new Set(["-r", "-R", "-f", "-rf", "-fr"]));
  requireArgCount("rm", args, 1);
  const recursive = flags.has("-r") || flags.has("-R") || flags.has("-rf") || flags.has("-fr");
  const force = flags.has("-f") || flags.has("-rf") || flags.has("-fr");
  const removed = [];
  for (const value of args) {
    const source = resolvePath(value, cwd);
    assertNotTrashPath(source, "delete");
    if (source === "/" || source === "/.trash") throw new VirtualFileSystemError("Cannot remove a protected virtual filesystem directory.");
    const entry = await getEntry(source);
    if (!entry) {
      if (force) continue;
      throw new VirtualFileSystemError(`No such file or directory: ${source}`);
    }
    if (entry.type === "directory" && (await listEntries(source)).length && !recursive) {
      throw new VirtualFileSystemError(`Cannot remove non-empty directory without -r: ${source}`);
    }
    removed.push(await moveToTrash(source, recursive));
  }
  return { command: "rm", movedToTrash: removed };
}

async function moveToTrash(source, recursive) {
  const entry = await getEntry(source);
  if (!entry) throw new VirtualFileSystemError(`No such file or directory: ${source}`);
  if (entry.type === "directory" && (await listEntries(source)).length && !recursive) {
    throw new VirtualFileSystemError(`Cannot remove non-empty directory without -r: ${source}`);
  }
  const trashPath = `/.trash/${Date.now()}-${randomId()}-${baseName(source)}`;
  await moveTree(source, trashPath);
  await putTrashRecord({
    trashPath,
    originalPath: source,
    deletedAt: Date.now(),
    originalVersion: Number(entry.version || 1),
    type: entry.type
  });
  return { from: source, to: trashPath };
}

function tokenizeCommand(value) {
  const source = String(value || "").trim();
  if (!source) return [];
  if (/[|;&<>`\n\r]/.test(source) || source.includes("$(")) {
    throw new VirtualFileSystemError("Shell operators, redirection, command substitution, and multi-command input are not supported.");
  }
  const tokens = [];
  let token = "";
  let quote = "";
  let escaping = false;
  for (const char of source) {
    if (escaping) {
      token += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += char;
  }
  if (escaping || quote) throw new VirtualFileSystemError("Unterminated escape or quoted string in command.");
  if (token) tokens.push(token);
  return tokens;
}

function parseFlags(rawArgs, allowedFlags) {
  const flags = new Set();
  const args = [];
  for (const value of rawArgs) {
    if (value.startsWith("-") && value !== "-") {
      if (!allowedFlags.has(value)) throw new VirtualFileSystemError(`Unsupported command flag: ${value}`);
      flags.add(value);
    } else {
      args.push(value);
    }
  }
  return { flags, args };
}

function requireArgCount(command, args, minimum, maximum = Infinity) {
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? String(minimum) : `${minimum}${maximum === Infinity ? "+" : `-${maximum}`}`;
    throw new VirtualFileSystemError(`${command} expects ${expected} path argument(s).`);
  }
}

function resolvePath(value, cwd) {
  return normalizePath(value, cwd);
}

function normalizePath(value, cwd = "/") {
  const raw = String(value || ".").trim();
  if (!raw || raw.includes("\0")) throw new VirtualFileSystemError("Invalid virtual filesystem path.");
  const parts = (raw.startsWith("/") ? raw : `${cwd}/${raw}`).split("/");
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return `/${normalized.join("/")}`;
}

function isTrashPath(path) {
  return path === "/.trash" || path.startsWith("/.trash/");
}

function assertNotTrashPath(path, action) {
  if (isTrashPath(path)) throw new VirtualFileSystemError(`Trash items can only be restored or permanently deleted; cannot ${action} ${path}.`);
}

function parentPath(path) {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function baseName(path) {
  return path.split("/").filter(Boolean).pop() || "root";
}

function publicEntry(entry) {
  return {
    path: entry.path,
    name: baseName(entry.path),
    type: entry.type,
    size: entry.size || 0,
    mimeType: entry.mimeType || "",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    version: entry.version || 1
  };
}

function newDirectory(path) {
  const now = Date.now();
  return { path, type: "directory", size: 0, mimeType: "", createdAt: now, updatedAt: now, version: 1 };
}

function newFile(path) {
  const now = Date.now();
  return { path, type: "file", size: 0, mimeType: "text/plain", createdAt: now, updatedAt: now, version: 1 };
}

async function ensureFileSystem() {
  for (const path of DEFAULT_DIRECTORIES) {
    const existing = await getEntry(path);
    if (!existing) await putEntry(newDirectory(path));
  }
}

async function ensureDirectoryPath(path) {
  const created = [];
  const parts = path.split("/").filter(Boolean);
  let cursor = "";
  for (const part of parts) {
    cursor += `/${part}`;
    const entry = await getEntry(cursor);
    if (!entry) {
      await putEntry(newDirectory(cursor));
      created.push(cursor);
    } else if (entry.type !== "directory") {
      throw new VirtualFileSystemError(`Cannot create directory '${path}': '${cursor}' is a file.`);
    }
  }
  return created;
}

async function ensureParentDirectory(path) {
  const parent = parentPath(path);
  const entry = await getEntry(parent);
  if (!entry || entry.type !== "directory") throw new VirtualFileSystemError(`Parent directory does not exist: ${parent}`);
}

async function resolveDestination(source, rawDestination, cwd) {
  const requested = resolvePath(rawDestination, cwd);
  const destinationEntry = await getEntry(requested);
  const destination = destinationEntry?.type === "directory" ? `${requested}/${baseName(source)}` : requested;
  if (await getEntry(destination)) throw new VirtualFileSystemError(`Destination already exists: ${destination}`);
  await ensureParentDirectory(destination);
  return destination;
}

async function copyTree(source, destination) {
  const sourceEntry = await getEntry(source);
  if (!sourceEntry) throw new VirtualFileSystemError(`No such file or directory: ${source}`);
  const entries = [sourceEntry, ...(sourceEntry.type === "directory" ? await descendantsOf(source) : [])];
  for (const entry of entries) {
    const targetPath = destination + entry.path.slice(source.length);
    const copy = { ...entry, path: targetPath, createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
    await putEntry(copy);
    if (entry.type === "file") {
      const content = await getContent(entry.path);
      if (content) await putContent(targetPath, content);
    }
  }
}

async function moveTree(source, destination) {
  const sourceEntry = await getEntry(source);
  if (!sourceEntry) throw new VirtualFileSystemError(`No such file or directory: ${source}`);
  const entries = [sourceEntry, ...(sourceEntry.type === "directory" ? await descendantsOf(source) : [])];
  entries.sort((a, b) => a.path.length - b.path.length);
  const contents = new Map();
  for (const entry of entries) {
    if (entry.type === "file") contents.set(entry.path, await getStoredContent(entry.path));
  }
  const db = await openDatabase();
  const transaction = db.transaction([ENTRY_STORE, CONTENT_STORE], "readwrite");
  const entriesStore = transaction.objectStore(ENTRY_STORE);
  const contentsStore = transaction.objectStore(CONTENT_STORE);
  for (const entry of entries) {
    const targetPath = destination + entry.path.slice(source.length);
    entriesStore.put({ ...entry, path: targetPath, updatedAt: Date.now(), version: Number(entry.version || 0) + 1 });
    if (entry.type === "file") {
      const content = contents.get(entry.path);
      if (content) contentsStore.put({ ...content, path: targetPath });
    }
  }
  for (const entry of [...entries].sort((a, b) => b.path.length - a.path.length)) {
    entriesStore.delete(entry.path);
    if (entry.type === "file") contentsStore.delete(entry.path);
  }
  await transactionDone(transaction);
}

async function purgeTree(source) {
  const sourceEntry = await getEntry(source);
  if (!sourceEntry) throw new VirtualFileSystemError(`No such file or directory: ${source}`);
  const entries = [sourceEntry, ...(sourceEntry.type === "directory" ? await descendantsOf(source) : [])];
  const db = await openDatabase();
  const transaction = db.transaction([ENTRY_STORE, CONTENT_STORE, TRASH_STORE], "readwrite");
  const entriesStore = transaction.objectStore(ENTRY_STORE);
  const contentsStore = transaction.objectStore(CONTENT_STORE);
  for (const entry of entries) {
    entriesStore.delete(entry.path);
    if (entry.type === "file") contentsStore.delete(entry.path);
  }
  transaction.objectStore(TRASH_STORE).delete(source);
  await transactionDone(transaction);
}

async function nextAvailablePath(path) {
  const parent = parentPath(path);
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${parent === "/" ? "" : parent}/${stem} (restored ${index})${extension}`;
    if (!(await getEntry(candidate))) return candidate;
  }
  throw new VirtualFileSystemError("Unable to find an available restore path.");
}

async function descendantsOf(directoryPath) {
  const all = await allEntries();
  const prefix = directoryPath === "/" ? "/" : `${directoryPath}/`;
  return all
    .filter((entry) => entry.path !== directoryPath && entry.path.startsWith(prefix))
    .sort((a, b) => a.path.length - b.path.length);
}

async function allEntries() {
  const db = await openDatabase();
  const transaction = db.transaction(ENTRY_STORE, "readonly");
  const all = await request(transaction.objectStore(ENTRY_STORE).getAll());
  await transactionDone(transaction);
  return all;
}

async function listEntries(directoryPath) {
  const all = await descendantsOf(directoryPath);
  return all.filter((entry) => parentPath(entry.path) === directoryPath).sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

async function getEntry(path) {
  const db = await openDatabase();
  const transaction = db.transaction(ENTRY_STORE, "readonly");
  const value = await request(transaction.objectStore(ENTRY_STORE).get(path));
  await transactionDone(transaction);
  return value || null;
}

async function putEntry(entry) {
  const db = await openDatabase();
  const transaction = db.transaction(ENTRY_STORE, "readwrite");
  transaction.objectStore(ENTRY_STORE).put(entry);
  await transactionDone(transaction);
}

async function getContent(path) {
  const stored = await getStoredContent(path);
  return stored?.blob || null;
}

async function getStoredContent(path) {
  const db = await openDatabase();
  const transaction = db.transaction(CONTENT_STORE, "readonly");
  const value = await request(transaction.objectStore(CONTENT_STORE).get(path));
  await transactionDone(transaction);
  return value || null;
}

async function putContent(path, blob) {
  const db = await openDatabase();
  const transaction = db.transaction(CONTENT_STORE, "readwrite");
  transaction.objectStore(CONTENT_STORE).put({ path, blob });
  await transactionDone(transaction);
}

async function getTrashRecord(trashPath) {
  const db = await openDatabase();
  const transaction = db.transaction(TRASH_STORE, "readonly");
  const value = await request(transaction.objectStore(TRASH_STORE).get(trashPath));
  await transactionDone(transaction);
  return value || null;
}

async function putTrashRecord(record) {
  const db = await openDatabase();
  const transaction = db.transaction(TRASH_STORE, "readwrite");
  transaction.objectStore(TRASH_STORE).put(record);
  await transactionDone(transaction);
}

async function deleteTrashRecord(trashPath) {
  const db = await openDatabase();
  const transaction = db.transaction(TRASH_STORE, "readwrite");
  transaction.objectStore(TRASH_STORE).delete(trashPath);
  await transactionDone(transaction);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const requestOpen = indexedDB.open(DB_NAME, DB_VERSION);
    requestOpen.onupgradeneeded = () => {
      const db = requestOpen.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE, { keyPath: "path" });
      if (!db.objectStoreNames.contains(CONTENT_STORE)) db.createObjectStore(CONTENT_STORE, { keyPath: "path" });
      if (!db.objectStoreNames.contains(TRASH_STORE)) db.createObjectStore(TRASH_STORE, { keyPath: "trashPath" });
    };
    requestOpen.onsuccess = () => resolve(requestOpen.result);
    requestOpen.onerror = () => reject(requestOpen.error || new VirtualFileSystemError("Unable to open virtual filesystem database."));
  });
}

function request(requestValue) {
  return new Promise((resolve, reject) => {
    requestValue.onsuccess = () => resolve(requestValue.result);
    requestValue.onerror = () => reject(requestValue.error || new VirtualFileSystemError("Virtual filesystem operation failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new VirtualFileSystemError("Virtual filesystem transaction failed."));
    transaction.onerror = () => reject(transaction.error || new VirtualFileSystemError("Virtual filesystem transaction failed."));
  });
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 10);
}

function unique(values) {
  return [...new Set(values)];
}
