// TARS's commands (PLAN-TARS-AGENT C1–C2, C5): what the field understands before the model — "/" commands, as
// the great agents have them (help, clear, compact, model, cost, mode, stop, undo, retry, export…), the
// pilot's own (his skills: saved requests, run by their name), and "@" mentions (a body, a site, a screen, a
// setting) — with their completions as one types. Pure: the words in, the suggestions and the parsed
// command out; main.ts runs them.

import type { Text } from "../i18n";
import { completeGame, GAME_COMMANDS, type GameCtx } from "./game-commands";

export interface Command {
  name: string;
  /** its argument, as the help writes it ("<model>", "on|off") */
  args?: string;
  desc: Text;
  /** the values its argument may take (completed as one types) */
  values?: (ctx: CompleteCtx) => { value: string; hint?: string }[];
}

/** where his mode and the pilot's skills are kept (this browser) */
export const TARS_MODE_KEY = "kerr.tars.mode";
export const TARS_SKILLS_KEY = "kerr.tars.skills";

export type Mode = "act" | "plan" | "watch";
export const MODES: Mode[] = ["act", "plan", "watch"];
export const MODE_WORDS: Record<Mode, Text> = {
  act: { fr: "Agir", en: "Act" },
  plan: { fr: "Proposer", en: "Propose" },
  watch: { fr: "Observer", en: "Observe" },
};

/** A saved request run by its name (C5). */
export interface Skill {
  name: string;
  description: string;
  prompt: string;
  at: number;
}

export interface CompleteCtx {
  /** the descriptions' language */
  lang?: "fr" | "en";
  models: { id: string; name: string }[];
  screens: readonly string[];
  bodies: { id: string; name: string }[];
  sites: { name: string; body: string }[];
  settings: { key: string; label: string }[];
  notes: readonly string[];
  skills: readonly Skill[];
  /** the game commands' values (C6) */
  game?: GameCtx;
}

const onOff = () => [{ value: "on" }, { value: "off" }];

export const COMMANDS: Command[] = [
  { name: "help", desc: { fr: "Les commandes, les modes, les raccourcis", en: "The commands, the modes, the shortcuts" } },
  { name: "clear", desc: { fr: "Nouvelle conversation (ses notes gardées)", en: "A new conversation (his notes kept)" } },
  { name: "compact", desc: { fr: "Résumer la conversation maintenant", en: "Summarize the conversation now" } },
  {
    name: "model",
    args: "<modèle>",
    desc: { fr: "Le modèle avec lequel il pense", en: "The model he thinks with" },
    values: (c) => c.models.map((m) => ({ value: m.id, hint: m.name })),
  },
  {
    name: "mode",
    args: "act|plan|watch",
    desc: {
      fr: "Agir · Proposer (il propose avant d'agir) · Observer (il n'agit pas) — Maj+Tab",
      en: "Act · Propose (he proposes before acting) · Observe (he does not act) — Shift+Tab",
    },
    values: () => MODES.map((m) => ({ value: m })),
  },
  {
    name: "plan",
    args: "<tâche>",
    desc: { fr: "Qu'il propose un plan pour une tâche, sans rien faire", en: "Have him propose a plan for a task, doing nothing" },
  },
  { name: "cost", desc: { fr: "Le coût : la session, l'heure, le budget", en: "The cost: the session, the hour, the budget" } },
  {
    name: "budget",
    args: "<$/h>",
    desc: { fr: "Le budget de ses réveils par heure", en: "His wakings' budget an hour" },
    values: () => ["0.02", "0.05", "0.1", "0.25"].map((value) => ({ value })),
  },
  { name: "status", desc: { fr: "L'état du vol, en une fiche", en: "The flight's state, on a card" } },
  { name: "telemetry", desc: { fr: "Attitude, air, autopilote, hub — en une fiche", en: "Attitude, air, autopilot, hub — on a card" } },
  {
    name: "show",
    args: "<écran>",
    desc: {
      fr: "Ouvrir un écran (carte, télémétrie, couloir de rentrée, graphe du hub, cockpit…)",
      en: "Open a screen (map, telemetry, entry corridor, hub graph, cockpit…)",
    },
    values: (c) => c.screens.map((value) => ({ value })),
  },
  { name: "stop", desc: { fr: "Arrêter le tour en cours (Échap)", en: "Stop the running turn (Esc)" } },
  {
    name: "undo",
    desc: {
      fr: "Revenir avant sa dernière téléportation, chargement, date ou scène",
      en: "Back before his last teleport, load, date or scene",
    },
  },
  { name: "retry", desc: { fr: "Reposer la dernière question", en: "Ask the last question again" } },
  { name: "export", desc: { fr: "Télécharger la conversation (Markdown)", en: "Download the conversation (Markdown)" } },
  { name: "memory", desc: { fr: "Ses notes et le résumé", en: "His notes and the summary" } },
  {
    name: "forget",
    args: "<note>",
    desc: { fr: "Oublier une note", en: "Forget a note" },
    values: (c) => c.notes.map((n) => ({ value: n })),
  },
  { name: "agents", desc: { fr: "Ses sous-agents", en: "His sub-agents" } },
  { name: "wakes", desc: { fr: "Ses réveils : réflexes et règles", en: "His wakings: reflexes and rules" } },
  { name: "reflexes", args: "on|off", desc: { fr: "Ses réveils, actifs ou non", en: "His wakings, on or off" }, values: onOff },
  { name: "voice", args: "on|off", desc: { fr: "Sa voix", en: "His voice" }, values: onOff },
  {
    name: "skill",
    args: "save <nom> | delete <nom>",
    desc: { fr: "Garder la dernière demande comme commande, ou l'effacer", en: "Keep the last request as a command, or delete one" },
    values: (c) => [{ value: "save " }, ...c.skills.map((s) => ({ value: `delete ${s.name}` }))],
  },
  { name: "dock", desc: { fr: "Remettre la console à sa place", en: "Put the console back in place" } },
  { name: "login", desc: { fr: "Se connecter avec OpenRouter", en: "Sign in with OpenRouter" } },
  { name: "key", desc: { fr: "Coller une clé OpenRouter", en: "Paste an OpenRouter key" } },
  { name: "logout", desc: { fr: "Oublier la clé OpenRouter", en: "Forget the OpenRouter key" } },
  {
    name: "deepgram",
    args: "off",
    desc: {
      fr: "Coller une clé Deepgram (lui parler dans tout navigateur) — off : l'oublier",
      en: "Paste a Deepgram key (speak to him in any browser) — off: forget it",
    },
    values: () => [{ value: "off" }],
  },
];

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export interface Suggestion {
  /** the field's text once chosen */
  text: string;
  label: string;
  hint?: string;
  kind: "command" | "skill" | "value" | "mention";
}

/** A "/" line read: the command (or skill) and its argument; null: not a command. */
export function parseCommand(input: string, skills: readonly Skill[] = []): { name: string; arg: string; skill?: Skill } | null {
  const m = /^\/([\w-]+)(?:\s+(.*))?$/s.exec(input.trim());
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const arg = (m[2] ?? "").trim();
  const skill = skills.find((s) => s.name.toLowerCase() === name);
  if (skill) return { name, arg, skill };
  return COMMANDS.some((c) => c.name === name) ? { name, arg } : null;
}

/** The mention token being typed at the end of the field ("@lu"), if any. */
const mentionAt = (input: string) => /(^|\s)@([^\s@]*)$/.exec(input);

/** What completes the field as typed (at most `max`). */
export function complete(input: string, ctx: CompleteCtx, max = 12): Suggestion[] {
  // ("/name arg…": the argument's values)
  const cmd = /^\/([\w-]+)\s+(.*)$/s.exec(input);
  if (cmd) {
    const c = COMMANDS.find((x) => x.name === cmd[1]!.toLowerCase());
    // (a game command's arguments — C6)
    if (!c && ctx.game) return (completeGame(input, ctx.game, max) ?? []).map((g) => ({ ...g, kind: "value" as const }));
    if (!c?.values) return [];
    const q = fold(cmd[2]!);
    return c
      .values(ctx)
      .filter((v) => fold(v.value).includes(q) || (v.hint && fold(v.hint).includes(q)))
      .slice(0, max)
      .map((v) => ({ text: `/${c.name} ${v.value}`, label: v.value, hint: v.hint, kind: "value" as const }));
  }
  // ("/na": the commands and skills by their start, then by their words)
  const slash = /^\/([\w-]*)$/.exec(input);
  if (slash) {
    const q = fold(slash[1]!);
    const all: Suggestion[] = [
      ...ctx.skills.map((s) => ({ text: `/${s.name} `, label: `/${s.name}`, hint: s.description, kind: "skill" as const })),
      ...COMMANDS.map((c) => ({
        text: `/${c.name}${c.args ? " " : ""}`,
        label: `/${c.name}${c.args ? ` ${c.args}` : ""}`,
        hint: c.desc[ctx.lang ?? "en"] as string | undefined,
        kind: "command" as const,
      })),
      ...GAME_COMMANDS.map((c) => ({
        text: `/${c.name}${c.args?.length || c.name === "tool" ? " " : ""}`,
        label: `/${c.name}${c.args?.length ? ` ${c.args.map((a) => `<${a.param}>`).join(" ")}` : c.name === "tool" ? " <outil> clé=valeur" : ""}`,
        hint: c.desc[ctx.lang ?? "en"] as string | undefined,
        kind: "command" as const,
      })),
    ];
    const starts = all.filter((s) => fold(s.label.slice(1)).startsWith(q));
    return starts.slice(0, max).map(({ text, label, hint, kind }) => ({ text, label, hint, kind }));
  }
  // ("… @lu": a body, a site, a screen, a setting)
  const m = mentionAt(input);
  if (m) {
    const q = fold(m[2]!);
    const head = input.slice(0, input.length - m[2]!.length - 1);
    const pool: { label: string; hint: string }[] = [
      ...ctx.bodies.map((b) => ({ label: b.name, hint: "◍" })),
      ...ctx.sites.map((s) => ({ label: s.name, hint: `⌖ ${s.body}` })),
      ...ctx.screens.map((s) => ({ label: s, hint: "▣" })),
      ...ctx.settings.map((s) => ({ label: s.key, hint: `⚙ ${s.label}` })),
    ];
    return pool
      .filter((p) => q.length > 0 && (fold(p.label).startsWith(q) || fold(p.label).includes(` ${q}`)))
      .slice(0, max)
      .map((p) => ({
        text: `${head}@${p.label.includes(" ") ? `"${p.label}"` : p.label} `,
        label: p.label,
        hint: p.hint,
        kind: "mention" as const,
      }));
  }
  return [];
}

/** The mentions in a question, made plain for the model ("@Lune" → "Lune", '@"Le Bourget"' → "Le Bourget"). */
export const unmention = (q: string) => q.replace(/@"([^"]+)"/g, "$1").replace(/(^|\s)@(\S+)/g, "$1$2");

/** The command's help, as lines. */
export function helpLines(lang: "fr" | "en", skills: readonly Skill[]): { label: string; value: string }[] {
  return [
    ...COMMANDS.map((c) => ({ label: `/${c.name}${c.args ? ` ${c.args}` : ""}`, value: c.desc[lang] })),
    ...GAME_COMMANDS.map((c) => ({
      label: `/${c.name}${c.args?.length ? ` ${c.args.map((a) => `<${a.param}>`).join(" ")}` : ""}`,
      value: c.desc[lang],
    })),
    ...skills.map((s) => ({ label: `/${s.name}`, value: `★ ${s.description}` })),
  ];
}
