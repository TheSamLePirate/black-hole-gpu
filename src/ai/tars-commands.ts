// The "/" commands run (PLAN-TARS-AGENT C1, C5): what the field does before the model — help, a new
// conversation, a summary now, the model, the mode, a plan asked for, the cost and the budget, the flight's
// state and telemetry on cards, a screen, stop, undo, retry, the conversation exported, his memory, his
// sub-agents and wakings, his voice, the pilot's skills, the console docked, the OpenRouter key. Each answers
// in a line on the console (or a card).

import { tr } from "../i18n";
import { AGENT_MODELS, openRouterKey, type OpenRouter } from "./openrouter";
import { helpLines, MODE_WORDS, MODES, type Mode, type Skill } from "./commands";
import { summaryPrompt, type TarsMemory } from "./memory";
import { telemetry } from "./telemetry";
import type { Tool } from "./agent";
import type { CameraController } from "../controls";
import type { GameTools } from "../game/tools";
import type { Settings } from "../settings";
import type { DataRow } from "../ui/tars/display";

export interface CommandHost {
  lang(): "fr" | "en";
  settings: Settings;
  camera: CameraController;
  tools: GameTools;
  or: OpenRouter;
  memory: TarsMemory;
  agentTools(): Tool[];
  skills: Skill[];
  saveSkills(): void;
  lastAsked(): string;
  mode(): Mode;
  setMode(m: Mode): void;
  budget: { lastHour(): number; why(): string | null };
  changed(keys: (keyof Settings)[]): void;
  /** a line on his console */
  say(text: string): void;
  card(title: string, rows: DataRow[], note?: string): void;
  ask(q: string, shown?: string): void;
  stop(): void;
  tab(t: "talk" | "agents" | "wakes" | "memory"): void;
  history(): void;
  dock(): void;
  connect(): void;
  pasteKey(): void;
  refresh(): void;
}

export async function runCommand(h: CommandHost, c: { name: string; arg: string; skill?: Skill }, typed: string) {
  const say = (fr: string, en: string) => h.say(tr({ fr, en }));
  const on = (a: string) => !/^(off|non|no|0|false)$/i.test(a);
  const tool = async (name: string, args: Record<string, unknown>) => {
    const t = h.agentTools().find((x) => x.name === name);
    if (!t) throw new Error(name);
    return t.run(args, new AbortController().signal);
  };
  const s = h.settings;
  if (c.skill) return h.ask(`${c.skill.prompt}${c.arg ? ` ${c.arg}` : ""}`, `★ ${typed}`);
  switch (c.name) {
    case "help":
      h.card(
        tr({ fr: "Commandes de TARS", en: "TARS's commands" }),
        helpLines(h.lang(), h.skills),
        tr({
          fr: "@ complète un corps, un site, un écran, un réglage · ↑ ↓ l'historique · Maj+Tab le mode · Échap arrête",
          en: "@ completes a body, a site, a screen, a setting · ↑ ↓ history · Shift+Tab mode · Esc stops",
        }),
      );
      return say("Les commandes sont à l'écran.", "The commands are on screen.");
    case "clear":
      h.memory.clearTurns();
      h.history();
      return say("Nouvelle conversation. Mes notes sont gardées.", "A new conversation. My notes are kept.");
    case "compact":
      await h.memory.compact(
        async (prev, turns) => h.or.chat(summaryPrompt(prev, turns), { maxTokens: 500, temperature: 0.2, timeoutMs: 30_000 }),
        true,
      );
      h.history();
      return say("Conversation résumée.", "Conversation summarized.");
    case "model": {
      const m =
        AGENT_MODELS.find((x) => x.id === c.arg) ??
        (c.arg ? AGENT_MODELS.find((x) => x.name.toLowerCase().includes(c.arg.toLowerCase())) : undefined);
      const list = AGENT_MODELS.map((x) => x.name).join(", ");
      if (!m) return say(`Modèles : ${list}.`, `Models: ${list}.`);
      s.tarsModel = m.id;
      h.changed(["tarsModel"]);
      h.refresh();
      return say(`Je pense maintenant avec ${m.name}.`, `I now think with ${m.name}.`);
    }
    case "mode": {
      const m = MODES.find((x) => x === c.arg.toLowerCase()) ?? MODES[(MODES.indexOf(h.mode()) + 1) % MODES.length]!;
      h.setMode(m);
      return h.say(`${tr({ fr: "Mode", en: "Mode" })} : ${tr(MODE_WORDS[m])}.`);
    }
    case "plan":
      if (!c.arg) return say("/plan <la tâche>", "/plan <the task>");
      return h.ask(tr({ fr: `Propose-moi un plan pour : ${c.arg}`, en: `Propose me a plan for: ${c.arg}` }), typed);
    case "cost":
      h.card(tr({ fr: "Coût de TARS", en: "TARS's cost" }), [
        { label: tr({ fr: "Cette session", en: "This session" }), value: `${h.or.spent.toFixed(4)} $` },
        { label: tr({ fr: "Dernière heure", en: "Last hour" }), value: `${h.budget.lastHour().toFixed(4)} $` },
        {
          label: tr({ fr: "Budget des réveils", en: "Wakings' budget" }),
          value: `${s.tarsBudget.toFixed(2)} $ / h`,
          tone: h.budget.why() === "budget" ? "caution" : "good",
        },
        { label: tr({ fr: "Appels", en: "Calls" }), value: String(h.or.calls) },
        { label: tr({ fr: "Modèle", en: "Model" }), value: AGENT_MODELS.find((m) => m.id === s.tarsModel)?.name ?? s.tarsModel },
      ]);
      return say("Le coût est à l'écran.", "The cost is on screen.");
    case "budget": {
      const v = Number(c.arg.replace(",", "."));
      if (!c.arg || !(v >= 0 && v <= 1)) return say("/budget <0 à 1 $ par heure>", "/budget <0 to 1 $ an hour>");
      s.tarsBudget = v;
      h.changed(["tarsBudget"]);
      return say(`Budget de mes réveils : ${v} $ par heure.`, `My wakings' budget: ${v} $ an hour.`);
    }
    case "status": {
      const st = h.tools.status();
      h.card(tr({ fr: "État du vol", en: "Flight state" }), [
        { label: tr({ fr: "Où", en: "Where" }), value: `${st.soiName} · ${st.label}` },
        { label: tr({ fr: "Altitude", en: "Altitude" }), value: `${st.altKm.toFixed(1)} km` },
        { label: tr({ fr: "Vitesse", en: "Speed" }), value: `${Math.round(st.speed)} m/s` },
        ...(st.orbit ? [{ label: "Pe · Ap", value: `${Math.round(st.orbit.peKm)} · ${Math.round(st.orbit.apKm)} km` }] : []),
        ...(st.target
          ? [
              {
                label: tr({ fr: "Cible", en: "Target" }),
                value: `${st.target.name} · ${Math.round(st.target.distKm).toLocaleString("fr")} km`,
              },
            ]
          : []),
        ...(st.next
          ? [{ label: tr({ fr: "Ensuite", en: "Next" }), value: `${st.next.kind} ${st.next.name} · ${Math.round(st.next.inS)} s` }]
          : []),
        { label: tr({ fr: "Pilote", en: "Pilot" }), value: h.tools.pilotState() },
      ]);
      return say("L'état du vol est à l'écran.", "The flight state is on screen.");
    }
    case "telemetry": {
      const tm = telemetry(h.camera, ["attitude", "air", "autopilot", "hub"]) as Record<string, Record<string, unknown> | null>;
      const rows: DataRow[] = [];
      for (const [g, v] of Object.entries(tm))
        if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v))
            if (x !== undefined && x !== null && typeof x !== "object") rows.push({ label: `${g} · ${k}`, value: String(x) });
      h.card(tr({ fr: "Télémétrie", en: "Telemetry" }), rows.slice(0, 16));
      return say("La télémétrie est à l'écran.", "The telemetry is on screen.");
    }
    case "show":
      if (!c.arg)
        return say("/show <écran> — tapez /show puis un espace pour la liste.", "/show <screen> — type /show and a space for the list.");
      return h.say(String(await tool("show_screen", { screen: c.arg })));
    case "stop":
      h.stop();
      return say("Arrêté.", "Stopped.");
    case "undo":
      await tool("saves", { action: "undo" });
      return say("Revenu avant ma dernière téléportation.", "Back before my last teleport.");
    case "retry":
      if (!h.lastAsked()) return say("Rien à reposer.", "Nothing to ask again.");
      return h.ask(h.lastAsked());
    case "export": {
      const m = h.memory;
      const md = [
        `# TARS — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        "",
        ...(m.notes.length ? ["## Notes", ...m.notes.map((n) => `- ${n}`), ""] : []),
        ...(m.summary ? ["## Summary", m.summary, ""] : []),
        "## Conversation",
        ...m.turns.flatMap((t) => [
          `**› ${t.user.replace(/^\[Woken[^\]]*\]\s*/, "⚡ ")}**`,
          "",
          t.tars || "—",
          ...(t.did?.length ? ["", ...t.did.map((d) => `  - ${d}`)] : []),
          "",
        ]),
      ].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = `tars-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return say("Conversation téléchargée.", "Conversation downloaded.");
    }
    case "memory":
      return h.tab("memory");
    case "forget": {
      const n = h.memory.forget(c.arg);
      return say(`${n} note(s) oubliée(s).`, `${n} note(s) forgotten.`);
    }
    case "agents":
      return h.tab("agents");
    case "wakes":
      return h.tab("wakes");
    case "reflexes":
      s.tarsWake = on(c.arg);
      h.changed(["tarsWake"]);
      return say(s.tarsWake ? "Réveils actifs." : "Réveils coupés.", s.tarsWake ? "Wakings on." : "Wakings off.");
    case "voice":
      s.voice = on(c.arg);
      h.changed(["voice"]);
      return say(s.voice ? "Voix active." : "Voix coupée.", s.voice ? "Voice on." : "Voice off.");
    case "skill": {
      const [verb, ...rest] = c.arg.split(/\s+/);
      const name = rest
        .join("-")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "");
      if (verb === "save" && name) {
        const q = h.lastAsked();
        if (!q) return say("Posez d'abord une demande à garder.", "Ask something first, to keep it.");
        const i = h.skills.findIndex((k) => k.name === name);
        const k = { name, description: q.slice(0, 80), prompt: q, at: Date.now() };
        if (i >= 0) h.skills[i] = k;
        else h.skills.push(k);
        h.saveSkills();
        return say(`Gardé : /${name}.`, `Kept: /${name}.`);
      }
      if (verb === "delete" && name) {
        const i = h.skills.findIndex((k) => k.name === name);
        if (i >= 0) h.skills.splice(i, 1);
        h.saveSkills();
        return say(i >= 0 ? `/${name} effacé.` : `Pas de /${name}.`, i >= 0 ? `/${name} deleted.` : `No /${name}.`);
      }
      return say("/skill save <nom> · /skill delete <nom>", "/skill save <name> · /skill delete <name>");
    }
    case "dock":
      return h.dock();
    case "login":
      return h.connect();
    case "key":
      return h.pasteKey();
    case "logout":
      openRouterKey.clear();
      h.refresh();
      return say("Clé oubliée.", "Key forgotten.");
  }
}
