// Processes, the same on macOS, Linux and Windows — what the lab's scripts list and end: the test Chromes,
// the tests, the servers. macOS/Linux: ps. Windows (the lab's PC): Win32_Process through PowerShell — no ps,
// no pkill, no process groups there; a process tree is ended by taskkill /T.

export interface Proc {
  pid: number;
  ppid: number;
  /** how long it has run, as ps's etime prints it ([[dd-]hh:]mm:ss) */
  elapsed: string;
  command: string;
}

export const WINDOWS = process.platform === "win32";

const etime = (s: number) => {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}-` : ""}${d || h ? `${p(h)}:` : ""}${p(m)}:${p(Math.floor(s % 60))}`;
};

/** PowerShell's -EncodedCommand: the script as UTF-16LE base64 — no quoting through cmd or bash to get wrong. */
export function powershell(script: string): string {
  // (no progress records: on a first use PowerShell writes them, as CLIXML, among the output)
  const enc = Buffer.from(`$ProgressPreference="SilentlyContinue"; ${script}`, "utf16le").toString("base64");
  return Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", enc], { stdout: "pipe", stderr: "pipe" })
    .stdout.toString()
    .trim();
}

/** Every process — or those whose command line matches `pattern`. */
export function processes(pattern?: RegExp): Proc[] {
  let all: Proc[];
  if (WINDOWS) {
    const json = powershell(
      "$n=Get-Date; Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{p=$_.ProcessId;q=$_.ParentProcessId;" +
        "s=[int]($n-$_.CreationDate).TotalSeconds;c=$(if($_.CommandLine){$_.CommandLine}else{$_.Name})} } | ConvertTo-Json -Compress",
    );
    let rows: { p: number; q: number; s: number; c: string }[] = [];
    try {
      rows = [JSON.parse(json || "[]")].flat();
    } catch {
      /* (PowerShell said something else: none) */
    }
    all = rows.map((r) => ({ pid: r.p, ppid: r.q, elapsed: etime(r.s || 0), command: r.c ?? "" }));
  } else
    all = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,etime=,command="], { stdout: "pipe" })
      .stdout.toString()
      .split("\n")
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), elapsed: m[3]!, command: m[4]! }));
  return pattern ? all.filter((p) => pattern.test(p.command)) : all;
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * A process left behind by whoever started it: on macOS/Linux adopted by launchd/init (parent 1); on Windows,
 * which adopts nothing, its parent gone.
 */
export const orphaned = (p: Proc) => (WINDOWS ? !alive(p.ppid) : p.ppid === 1);

/** The process and everything it started, ended now. */
export function killTree(pid: number) {
  if (WINDOWS) Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(pid)], { stdout: "ignore", stderr: "ignore" });
  else
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* (gone meanwhile) */
    }
}

/** The Chrome every script starts (CHROME=… to choose another): where each system installs Google Chrome. */
export const CHROME =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : WINDOWS
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : "google-chrome");

/** A test Chrome ended — its process, and all it started (its GPU, its renderers): by its DevTools port elsewhere. */
export function endChrome(proc: { pid: number; kill(): void }, port: number) {
  if (WINDOWS) killTree(proc.pid);
  else {
    proc.kill();
    Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
  }
}
