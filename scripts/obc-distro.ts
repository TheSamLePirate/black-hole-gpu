// The OBC's distro images that are not in Git (Debian, 72 MB): downloaded from unkernel's GitHub release of the PINNED package
// version, then checked against the size and SHA-256 committed in assets/obc/distros.json — a mismatch is an error, never a
// silently different image (review of 24 Nov 2026: build-pages took whatever fetchDistro("debian") returned).
// Used by scripts/build-pages.ts (the published site) and server.ts (the dev server's /obc/debian.erofs).
//
// Bumping unkernel: update UNKERNEL_RELEASE, then assets/obc/distros.json from that release's distros.json (its sizes and
// sha256), and the exact version in package.json.

/** The unkernel release the images come from — the exact version pinned in package.json. */
export const UNKERNEL_RELEASE = "0.2.0-261121-e69adda";
export const UNKERNEL_RELEASE_URL = `https://github.com/pithings/unkernel/releases/download/v${UNKERNEL_RELEASE}/`;

interface DistroEntry {
  name: string;
  file: string;
  size: number;
  sha256: string;
  image: string;
}

/** The committed index's entry for `name`. */
export async function pinnedDistroEntry(name: string, indexPath = "assets/obc/distros.json"): Promise<DistroEntry> {
  const index = (await Bun.file(indexPath).json()) as { distros?: DistroEntry[] };
  const entry = index.distros?.find((d) => d.name === name);
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256) || !(entry.size > 0)) {
    throw new Error(`${indexPath}: no pinned size + sha256 for the "${name}" distro`);
  }
  return entry;
}

/** The SHA-256 of a file, streamed (hex). */
export async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
  }
  return h.digest("hex");
}

/** Throws unless the file at `path` is the pinned image (size, then SHA-256). */
export async function verifyDistro(path: string, entry: DistroEntry): Promise<void> {
  const size = Bun.file(path).size;
  if (size !== entry.size) throw new Error(`${path}: ${size} bytes, the pinned ${entry.image} has ${entry.size}`);
  const sum = await sha256File(path);
  if (sum !== entry.sha256) throw new Error(`${path}: sha256 ${sum}, the pinned ${entry.image} has ${entry.sha256}`);
}

/**
 * The local path of the pinned `name` image: `localPath` when it exists (checked when `verifyLocal`), else downloaded from the
 * pinned release (unkernel's cache) and checked.
 */
export async function pinnedDistroPath(name: string, localPath: string, verifyLocal: boolean): Promise<string> {
  const entry = await pinnedDistroEntry(name);
  if (await Bun.file(localPath).exists()) {
    if (verifyLocal) await verifyDistro(localPath, entry);
    return localPath;
  }
  const pkg = (await Bun.file("node_modules/unkernel/package.json").json()) as { version?: string };
  if (pkg.version !== UNKERNEL_RELEASE) {
    throw new Error(`unkernel ${pkg.version} installed, images pinned to ${UNKERNEL_RELEASE} (scripts/obc-distro.ts)`);
  }
  const { fetchDistro } = await import("unkernel/node");
  const path = await fetchDistro(name, { releaseUrl: UNKERNEL_RELEASE_URL, local: false });
  await verifyDistro(path, entry);
  return path;
}
