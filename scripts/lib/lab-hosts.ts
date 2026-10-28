// The lab's other machines — where scripts/remote.ts sends jobs, what scripts/lab-monitor.ts and the dashboard
// show (docs/REMOTE-TESTS.md). Each is an ssh alias of ~/.ssh/config; paths are relative to its home.
//
//   kerr-mini  the Mac mini M1 on the LAN: its copy of the tree sent by rsync, jobs in APFS clones of it
//   kerr-pc    the Windows PC (RTX 5070 Ti, Ryzen 9 5950X) over Tailscale: OpenSSH's shell is cmd, so every
//              command goes through Git Bash; its tree is a git worktree of its own clone, put at the pushed
//              commit this tree comes from with this tree's changes laid over it (no rsync there); jobs run
//              in its desktop session (a scheduled task: the full-screen Chrome shows on its screen)
//
// KERR_REMOTE chooses the host when no --host is given (kerr-mini); KERR_REMOTE_DIR / KERR_REMOTE_CLONE still
// override the default host's folders.

export interface LabHost {
  /** its ssh alias */
  name: string;
  os: "mac" | "windows";
  /** what the monitor calls it */
  label: string;
  /** the runner's folder (base/, runs/, gpu.lock) */
  dir: string;
  /** its own clone of the repository, pulled at each sync (empty: none) */
  clone: string;
  /** bun there, as its shell finds it */
  bun: string;
}

export const HOSTS: LabHost[] = [
  {
    name: "kerr-mini",
    os: "mac",
    label: "Mac mini M1",
    dir: "kerr-runner",
    clone: "Documents/DEV/black-hole-gpu",
    bun: "~/.bun/bin/bun",
  },
  {
    name: "kerr-pc",
    os: "windows",
    label: "PC Windows RTX 5070 Ti",
    dir: "Desktop/sam/kerr-runner",
    clone: "Desktop/sam/benchmark-main",
    bun: "bun",
  },
];

/** A host by its name (KERR_REMOTE, else kerr-mini); an unknown name: a Mac at the default folders. */
export function labHost(name = process.env.KERR_REMOTE ?? "kerr-mini"): LabHost {
  const known = HOSTS.find((h) => h.name === name);
  const h = known ?? { ...HOSTS[0]!, name, label: name };
  return name === (process.env.KERR_REMOTE ?? "kerr-mini")
    ? { ...h, dir: process.env.KERR_REMOTE_DIR ?? h.dir, clone: process.env.KERR_REMOTE_CLONE ?? h.clone }
    : h;
}

/** `--host <name>` taken out of argv (its value returned), else undefined. */
export function takeHost(argv: string[]): string | undefined {
  const i = argv.indexOf("--host");
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}

// (Git Bash, where Git for Windows puts it)
const WIN_BASH = String.raw`"C:\Program Files\Git\bin\bash.exe"`;

/**
 * A POSIX shell script as the command line ssh sends: as it is to a Mac (its login shell, zsh, runs it); to
 * Windows, whose OpenSSH hands it to cmd, carried in base64 into Git Bash — no quote or `|` for cmd to read,
 * stdin and the exit code passed through.
 */
export function remoteCommand(h: LabHost, script: string): string {
  if (h.os !== "windows") return script;
  return `${WIN_BASH} -c "source <(base64 -d <<<${Buffer.from(script).toString("base64")})"`;
}
