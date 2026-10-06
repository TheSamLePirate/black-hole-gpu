// The shell words of scripts/remote.ts, for the other Mac.

/**
 * The command for the other Mac's zsh, its words as this shell gave them: one that holds a shell character
 * quoted (`--only 'a|b'` reached the other side as a pipe — "command not found", the job's worker gone with
 * it); a lone operator kept (&&, ||, |, ;: what was typed quoted to reach there as one); a single word with
 * spaces — `-- 'E2E=1 bun test x && y'` — passed as written, the command line itself.
 */
export function shellJoin(words: string[]): string {
  if (words.length === 1) return words[0]!;
  return words.map((w) => (/^(&&|\|\||\||;)$/.test(w) || /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(" ");
}
