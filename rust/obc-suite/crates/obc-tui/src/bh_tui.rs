//! AAA Universal `__bh` API, 73 TARS Tools & Command Center (`bh-tui`).
//!
//! Features:
//! - 5 interactive tabs: `__bh API` tree, `TARS TOOLS` (all 73 tools), `FUZZY ALL` global command
//!   palette (every `__bh` function/property + every TARS tool + curated Quick Actions),
//!   `ACTIONS` 1-click simulator control deck, and `LOG & TEL` (execution history with re-run +
//!   live `/obc/telemetry.json`).
//! - Multi-token fuzzy subsequence search (`/` or `Ctrl+P` / `f`) with camelCase & boundary scoring
//!   and bold amber character highlighting.
//! - Interactive execution modals for EVERYTHING:
//!   - **TARS Tool Runner Form** with typed fields (`enum` picker via `←`/`→`/`Space`, `bool` toggle,
//!     `number`/`string`/`json` editor, `[REQ]` badges, live range/description hints, `Ctrl+E` raw JSON).
//!   - **`__bh` Function Caller** with auto-extracted JS parameter names, smart argument parsing,
//!     `Ctrl+A` add-arg, and `Ctrl+E` raw JSON array mode.
//!   - **`__bh` Property Editor** (`op: "set"` with automatic `__bh.refresh()` on `settings.*`).
//!   - **Vim-style `:` Eval Command Bar** for arbitrary CSP-safe `bh.*` expressions, assignments,
//!     and `tool <name> <json>` commands with `↑`/`↓` history.

use crate::fuzzy::{fuzzy_match, highlight_spans};
use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use obc_core::{AvionicsBus, BhMember, TarsParamSpec, TarsToolInfo};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, BorderType, Borders, Cell, Clear, Paragraph, Row, Table, TableState, Tabs, Wrap,
};
use serde_json::{Map, Value, json};
use std::fmt::Write as _;
use std::time::Instant;

const C_CYN: Color = Color::Rgb(98, 230, 255);
const C_GRN: Color = Color::Rgb(110, 248, 148);
const C_AMB: Color = Color::Rgb(255, 196, 56);
const C_RED: Color = Color::Rgb(255, 108, 108);
const C_MAG: Color = Color::Rgb(206, 147, 255);
const C_DIM: Color = Color::Rgb(118, 158, 178);
const C_SEL_BG: Color = Color::Rgb(16, 56, 76);
const C_MODAL_BG: Color = Color::Rgb(10, 24, 34);

#[derive(Debug, Clone)]
enum QuickExec {
    Tool { name: String, args: Value },
    BhCall { path: String, args: Value },
    BhEval { expr: String },
    Mcdu { action: String, arg: Option<String> },
}

#[derive(Debug, Clone)]
struct QuickAction {
    category: &'static str,
    title: &'static str,
    description: &'static str,
    exec: QuickExec,
}

#[derive(Debug, Clone)]
enum CatalogItem {
    Tars(usize),
    Bh(usize),
    Action(usize),
}

#[derive(Debug, Clone)]
struct FilteredRow {
    index: usize,
    score: i32,
    positions: Vec<usize>,
}

#[derive(Debug, Clone)]
struct HistoryEntry {
    label: String,
    ok: bool,
    ms: u128,
    summary: String,
    full_output: String,
    exec: QuickExec,
}

#[derive(Debug, Clone)]
struct TarsFormField {
    spec: TarsParamSpec,
    value: String,
}

#[derive(Debug, Clone)]
struct TarsModal {
    tool: TarsToolInfo,
    fields: Vec<TarsFormField>,
    selected: usize,
    raw_mode: bool,
    raw_json: String,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct BhCallModal {
    path: String,
    labels: Vec<String>,
    values: Vec<String>,
    selected: usize,
    raw_mode: bool,
    raw_json: String,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct BhSetModal {
    path: String,
    kind: String,
    value: String,
    error: Option<String>,
}

#[derive(Debug, Clone)]
enum Modal {
    None,
    Tars(TarsModal),
    BhCall(BhCallModal),
    BhSet(BhSetModal),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InputFocus {
    Normal,
    Search,
    EvalBar,
}

fn default_quick_actions() -> Vec<QuickAction> {
    vec![
        QuickAction {
            category: "CRAFT",
            title: "Fly F-35B Lightning II",
            description: "Switch active craft to F-35B stealth fighter",
            exec: QuickExec::Tool {
                name: "set_craft".into(),
                args: json!({ "ship": true, "vessel": "f35" }),
            },
        },
        QuickAction {
            category: "CRAFT",
            title: "Fly Airbus A320",
            description: "Switch active craft to Airbus A320 airliner",
            exec: QuickExec::Tool {
                name: "set_craft".into(),
                args: json!({ "ship": true, "vessel": "a320" }),
            },
        },
        QuickAction {
            category: "CRAFT",
            title: "Fly Ranger Spacecraft",
            description: "Switch active craft to Endurance Ranger SSTO",
            exec: QuickExec::Tool {
                name: "set_craft".into(),
                args: json!({ "ship": true, "vessel": "ranger" }),
            },
        },
        QuickAction {
            category: "CRAFT",
            title: "Fly Lander",
            description: "Switch active craft to Heavy Lander",
            exec: QuickExec::Tool {
                name: "set_craft".into(),
                args: json!({ "ship": true, "vessel": "lander" }),
            },
        },
        QuickAction {
            category: "CRAFT",
            title: "Fly Endurance",
            description: "Switch active craft to Endurance mothership",
            exec: QuickExec::Tool {
                name: "set_craft".into(),
                args: json!({ "ship": true, "vessel": "endurance" }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Orbit Earth (400 km LEO)",
            description: "Place craft in 400 km circular Earth orbit",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "orbit", "body": "earth", "altKm": 400 }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Orbit Moon (120 km)",
            description: "Place craft in 120 km lunar orbit",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "orbit", "body": "moon", "altKm": 120 }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Orbit Mars (300 km)",
            description: "Place craft in 300 km Martian orbit",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "orbit", "body": "mars", "altKm": 300 }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Orbit Gargantua (12 M)",
            description: "Jump to Gargantua black hole accretion disk orbit",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "orbit", "body": "gargantua", "rM": 12 }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Lineup Paris-Le Bourget (LFPB)",
            description: "Line up on LFPB runway ready for takeoff",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "lineup", "query": "LFPB" }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Lineup Nice Côte d'Azur (LFMN)",
            description: "Line up on LFMN runway ready for takeoff",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "lineup", "query": "LFMN" }),
            },
        },
        QuickAction {
            category: "WORLD",
            title: "Lineup San Francisco (KSFO)",
            description: "Line up on KSFO runway ready for takeoff",
            exec: QuickExec::Tool {
                name: "place_ship".into(),
                args: json!({ "mode": "lineup", "query": "KSFO" }),
            },
        },
        QuickAction {
            category: "DISPLAY",
            title: "A320 Lower ECAM → Linux OBC",
            description: "Show Linux OBC framebuffer/terminal on A320 Lower ECAM",
            exec: QuickExec::Mcdu {
                action: "ecam".into(),
                arg: Some("obcPage".into()),
            },
        },
        QuickAction {
            category: "DISPLAY",
            title: "A320 MCDU → OBC LINUX LINK",
            description: "Open OBC LINUX LINK page on Captain MCDU",
            exec: QuickExec::Mcdu {
                action: "page".into(),
                arg: Some("obc".into()),
            },
        },
        QuickAction {
            category: "DISPLAY",
            title: "Show 3D Orbit Map",
            description: "Open interactive 3D orbital map overlay",
            exec: QuickExec::Tool {
                name: "show_screen".into(),
                args: json!({ "screen": "map_3d" }),
            },
        },
        QuickAction {
            category: "DISPLAY",
            title: "Show Telemetry Tablet",
            description: "Open live flight telemetry curves page",
            exec: QuickExec::Tool {
                name: "show_screen".into(),
                args: json!({ "screen": "telemetry" }),
            },
        },
        QuickAction {
            category: "FLIGHT",
            title: "SAS Stabilization ON",
            description: "Enable attitude stability augmentation",
            exec: QuickExec::Tool {
                name: "controls".into(),
                args: json!({ "sas": true }),
            },
        },
        QuickAction {
            category: "FLIGHT",
            title: "Landing Gear DOWN",
            description: "Extend landing gear",
            exec: QuickExec::Tool {
                name: "controls".into(),
                args: json!({ "gear": true }),
            },
        },
        QuickAction {
            category: "FLIGHT",
            title: "Landing Gear UP",
            description: "Retract landing gear",
            exec: QuickExec::Tool {
                name: "controls".into(),
                args: json!({ "gear": false }),
            },
        },
        QuickAction {
            category: "AUTO",
            title: "Autopilot: Circularize Orbit",
            description: "Engage orbital circularization autopilot",
            exec: QuickExec::Tool {
                name: "autopilot".into(),
                args: json!({ "mode": "circularize" }),
            },
        },
        QuickAction {
            category: "AUTO",
            title: "Autopilot: Hover",
            description: "Engage powered hover autopilot",
            exec: QuickExec::Tool {
                name: "autopilot".into(),
                args: json!({ "mode": "hover" }),
            },
        },
        QuickAction {
            category: "AUTO",
            title: "Autopilot: OFF / Release",
            description: "Disengage autopilot and attitude hold",
            exec: QuickExec::Tool {
                name: "flight_action".into(),
                args: json!({ "action": "release" }),
            },
        },
        QuickAction {
            category: "TIME",
            title: "Resume Real Time (1×)",
            description: "Unpause simulation at 1× real time",
            exec: QuickExec::Tool {
                name: "time".into(),
                args: json!({ "running": true, "warp": 1 }),
            },
        },
        QuickAction {
            category: "TIME",
            title: "Pause Simulation",
            description: "Pause simulation clock",
            exec: QuickExec::Tool {
                name: "time".into(),
                args: json!({ "running": false }),
            },
        },
        QuickAction {
            category: "TIME",
            title: "Time Warp 100×",
            description: "Accelerate simulation clock to 100× real time",
            exec: QuickExec::Tool {
                name: "time".into(),
                args: json!({ "running": true, "warp": 100 }),
            },
        },
        QuickAction {
            category: "STATUS",
            title: "Read Flight State (get_state)",
            description: "Query complete TARS flight state snapshot",
            exec: QuickExec::Tool {
                name: "get_state".into(),
                args: json!({}),
            },
        },
        QuickAction {
            category: "STATUS",
            title: "Read Weather (get_weather)",
            description: "Query live local weather, winds & clouds",
            exec: QuickExec::Tool {
                name: "get_weather".into(),
                args: json!({}),
            },
        },
        QuickAction {
            category: "OBC",
            title: "OBC Status & Kernel Info",
            description: "Query embedded Linux OBC runtime status",
            exec: QuickExec::Tool {
                name: "obc".into(),
                args: json!({ "action": "status" }),
            },
        },
    ]
}

/// Smartly parse a user-typed value string into a typed JSON value.
fn parse_smart_value(raw: &str, expected_kind: &str) -> Result<Value, String> {
    let s = raw.trim();
    match expected_kind {
        "boolean" | "bool" => match s.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Ok(Value::Bool(true)),
            "false" | "0" | "no" | "off" => Ok(Value::Bool(false)),
            _ => Err(format!("expected true or false, got \"{s}\"")),
        },
        "number" | "num" => s
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| format!("expected finite number, got \"{s}\"")),
        "array" | "object" => serde_json::from_str::<Value>(s)
            .map_err(|e| format!("invalid JSON {expected_kind}: {e}")),
        "string" | "str" => Ok(Value::String(s.to_string())),
        _ => {
            if s.is_empty() {
                return Ok(Value::Null);
            }
            if s.eq_ignore_ascii_case("true") {
                return Ok(Value::Bool(true));
            }
            if s.eq_ignore_ascii_case("false") {
                return Ok(Value::Bool(false));
            }
            if s.eq_ignore_ascii_case("null") {
                return Ok(Value::Null);
            }
            if let Ok(i) = s.parse::<i64>() {
                return Ok(json!(i));
            }
            if let Ok(f) = s.parse::<f64>()
                && f.is_finite()
                && let Some(num) = serde_json::Number::from_f64(f)
            {
                return Ok(Value::Number(num));
            }
            if (s.starts_with('{') && s.ends_with('}'))
                || (s.starts_with('[') && s.ends_with(']'))
                || (s.starts_with('"') && s.ends_with('"'))
            {
                return serde_json::from_str::<Value>(s).map_err(|e| format!("invalid JSON: {e}"));
            }
            Ok(Value::String(s.to_string()))
        }
    }
}

fn pretty_json(val: &Value) -> String {
    serde_json::to_string_pretty(val).unwrap_or_else(|_| val.to_string())
}

fn compact_summary(val: &Value) -> String {
    let raw = serde_json::to_string(val).unwrap_or_default();
    if raw.chars().count() > 54 {
        let head: String = raw.chars().take(53).collect();
        format!("{head}…")
    } else {
        raw
    }
}

fn centered_rect(pct_x: u16, pct_y: u16, area: Rect) -> Rect {
    let vert = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - pct_y) / 2),
            Constraint::Percentage(pct_y),
            Constraint::Percentage((100 - pct_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - pct_x) / 2),
            Constraint::Percentage(pct_x),
            Constraint::Percentage((100 - pct_x) / 2),
        ])
        .split(vert[1])[1]
}

fn kind_color(kind: &str) -> Color {
    match kind {
        "fn" => C_GRN,
        "obj" | "object" => C_CYN,
        "num" | "number" => C_AMB,
        "bool" | "boolean" => C_MAG,
        _ => Color::White,
    }
}

pub struct BhTuiApp {
    bus: AvionicsBus,
    tab: usize, // 0 = __bh API, 1 = TARS TOOLS, 2 = FUZZY ALL, 3 = ACTIONS, 4 = LOG & TEL
    bh_path: String,
    entries: Vec<BhMember>,
    catalog_members: Vec<BhMember>,
    tools: Vec<TarsToolInfo>,
    actions: Vec<QuickAction>,
    catalog_items: Vec<CatalogItem>,
    filtered: Vec<FilteredRow>,
    table_state: TableState,
    search_query: String,
    focus: InputFocus,
    eval_input: String,
    eval_history: Vec<String>,
    eval_hist_idx: Option<usize>,
    modal: Modal,
    history: Vec<HistoryEntry>,
    show_telemetry_in_log: bool,
    inspect_title: String,
    inspect_body: String,
    inspect_scroll: u16,
    show_last_result: bool,
    last_status: Option<(bool, String)>,
    online: bool,
}

impl BhTuiApp {
    #[must_use]
    pub fn new() -> Self {
        let mut app = Self {
            bus: AvionicsBus::new(),
            tab: 0,
            bh_path: String::new(),
            entries: Vec::new(),
            catalog_members: Vec::new(),
            tools: Vec::new(),
            actions: default_quick_actions(),
            catalog_items: Vec::new(),
            filtered: Vec::new(),
            table_state: TableState::default(),
            search_query: String::new(),
            focus: InputFocus::Normal,
            eval_input: String::new(),
            eval_history: Vec::new(),
            eval_hist_idx: None,
            modal: Modal::None,
            history: Vec::new(),
            show_telemetry_in_log: false,
            inspect_title: " INSPECTOR ".into(),
            inspect_body: "Press Enter to open/run, / to fuzzy search, Ctrl+P for global palette, : to eval.".into(),
            inspect_scroll: 0,
            show_last_result: false,
            last_status: None,
            online: true,
        };
        app.load_all_online();
        app.rebuild_filter();
        app.refresh_inspector_preview();
        app
    }

    #[must_use]
    pub fn offline() -> Self {
        let entries = vec![
            BhMember {
                name: "fleet".into(),
                path: "fleet".into(),
                kind: "obj".into(),
                preview: "Object(3)".into(),
                arity: None,
                fn_params: Vec::new(),
            },
            BhMember {
                name: "freeze".into(),
                path: "freeze".into(),
                kind: "fn".into(),
                preview: "fn(on)".into(),
                arity: Some(1),
                fn_params: vec!["on".into()],
            },
            BhMember {
                name: "bloom".into(),
                path: "settings.bloom".into(),
                kind: "num".into(),
                preview: "0.4".into(),
                arity: None,
                fn_params: Vec::new(),
            },
        ];
        let tools = vec![
            TarsToolInfo {
                name: "approach".into(),
                description: "List or select real ILS approaches at any airfield".into(),
                params: vec!["action".into(), "field".into()],
                required: vec!["action".into()],
                param_specs: vec![
                    TarsParamSpec {
                        name: "action".into(),
                        kind: "string".into(),
                        required: true,
                        description: "Operation mode".into(),
                        choices: vec!["list".into(), "select".into(), "engage".into()],
                        min: None,
                        max: None,
                        integer: false,
                    },
                    TarsParamSpec {
                        name: "field".into(),
                        kind: "string".into(),
                        required: false,
                        description: "ICAO airfield code (e.g. LFPB, KSFO)".into(),
                        choices: Vec::new(),
                        min: None,
                        max: None,
                        integer: false,
                    },
                ],
            },
            TarsToolInfo {
                name: "obc".into(),
                description: "Control embedded Linux OBC".into(),
                params: vec!["action".into()],
                required: vec!["action".into()],
                param_specs: vec![TarsParamSpec {
                    name: "action".into(),
                    kind: "string".into(),
                    required: true,
                    description: "OBC action".into(),
                    choices: vec!["status".into(), "boot".into(), "reboot".into()],
                    min: None,
                    max: None,
                    integer: false,
                }],
            },
        ];
        let mut app = Self {
            bus: AvionicsBus::new(),
            tab: 0,
            bh_path: String::new(),
            catalog_members: entries.clone(),
            entries,
            tools,
            actions: default_quick_actions(),
            catalog_items: Vec::new(),
            filtered: Vec::new(),
            table_state: TableState::default(),
            search_query: String::new(),
            focus: InputFocus::Normal,
            eval_input: String::new(),
            eval_history: Vec::new(),
            eval_hist_idx: None,
            modal: Modal::None,
            history: Vec::new(),
            show_telemetry_in_log: false,
            inspect_title: " INSPECTOR ".into(),
            inspect_body: "Offline preview mode".into(),
            inspect_scroll: 0,
            show_last_result: false,
            last_status: None,
            online: false,
        };
        app.rebuild_catalog_items();
        app.rebuild_filter();
        app.refresh_inspector_preview();
        app
    }

    fn load_all_online(&mut self) {
        if !self.online {
            return;
        }
        let cat = self.bus.bh_catalog();
        if !cat.members.is_empty() {
            self.catalog_members = cat.members;
        }
        if cat.tools.is_empty() {
            self.tools = self.bus.tars_tools_rich();
        } else {
            self.tools = cat.tools;
        }
        self.entries = self.bus.bh_ls_rich(&self.bh_path);
        if self.catalog_members.is_empty() {
            self.catalog_members.clone_from(&self.entries);
        }
        self.rebuild_catalog_items();
    }

    fn reload_bh(&mut self) {
        if !self.online {
            return;
        }
        self.entries = self.bus.bh_ls_rich(&self.bh_path);
        self.rebuild_filter();
        self.refresh_inspector_preview();
    }

    fn rebuild_catalog_items(&mut self) {
        self.catalog_items.clear();
        for i in 0..self.actions.len() {
            self.catalog_items.push(CatalogItem::Action(i));
        }
        for i in 0..self.tools.len() {
            self.catalog_items.push(CatalogItem::Tars(i));
        }
        for i in 0..self.catalog_members.len() {
            self.catalog_items.push(CatalogItem::Bh(i));
        }
    }

    fn rebuild_filter(&mut self) {
        let q = self.search_query.trim();
        self.filtered.clear();
        match self.tab {
            0 => {
                for (i, m) in self.entries.iter().enumerate() {
                    if let Some(fm) = fuzzy_match(q, &m.name, &m.preview) {
                        self.filtered.push(FilteredRow {
                            index: i,
                            score: fm.score,
                            positions: fm.positions,
                        });
                    }
                }
            }
            1 => {
                for (i, t) in self.tools.iter().enumerate() {
                    let secondary = format!("{} {}", t.description, t.params.join(" "));
                    if let Some(fm) = fuzzy_match(q, &t.name, &secondary) {
                        self.filtered.push(FilteredRow {
                            index: i,
                            score: fm.score,
                            positions: fm.positions,
                        });
                    }
                }
            }
            2 => {
                for (i, item) in self.catalog_items.iter().enumerate() {
                    let (primary, secondary, boost) = match *item {
                        CatalogItem::Action(ai) => {
                            let a = &self.actions[ai];
                            (
                                a.title.to_string(),
                                format!("{} {}", a.category, a.description),
                                18,
                            )
                        }
                        CatalogItem::Tars(ti) => {
                            let t = &self.tools[ti];
                            (
                                t.name.clone(),
                                format!("tars {} {}", t.description, t.params.join(" ")),
                                12,
                            )
                        }
                        CatalogItem::Bh(bi) => {
                            let m = &self.catalog_members[bi];
                            let b = if m.kind == "fn" { 8 } else { 0 };
                            (m.path.clone(), format!("{} {}", m.kind, m.preview), b)
                        }
                    };
                    if let Some(fm) = fuzzy_match(q, &primary, &secondary) {
                        self.filtered.push(FilteredRow {
                            index: i,
                            score: if q.is_empty() { 0 } else { fm.score + boost },
                            positions: fm.positions,
                        });
                    }
                }
            }
            3 => {
                for (i, a) in self.actions.iter().enumerate() {
                    let secondary = format!("{} {}", a.category, a.description);
                    if let Some(fm) = fuzzy_match(q, a.title, &secondary) {
                        self.filtered.push(FilteredRow {
                            index: i,
                            score: fm.score,
                            positions: fm.positions,
                        });
                    }
                }
            }
            4 => {
                for (i, h) in self.history.iter().enumerate() {
                    if let Some(fm) = fuzzy_match(q, &h.label, &h.summary) {
                        self.filtered.push(FilteredRow {
                            index: i,
                            score: fm.score,
                            positions: fm.positions,
                        });
                    }
                }
            }
            _ => {}
        }
        if !q.is_empty() {
            self.filtered.sort_by(|a, b| b.score.cmp(&a.score).then(a.index.cmp(&b.index)));
        }
        if self.filtered.is_empty() {
            self.table_state.select(None);
        } else {
            let cur = self.table_state.selected().unwrap_or(0);
            self.table_state.select(Some(cur.min(self.filtered.len() - 1)));
        }
    }

    fn selected_filtered(&self) -> Option<&FilteredRow> {
        let sel = self.table_state.selected()?;
        self.filtered.get(sel)
    }

    fn switch_tab(&mut self, next_tab: usize) {
        self.tab = next_tab % 5;
        self.show_last_result = false;
        self.inspect_scroll = 0;
        self.table_state.select(Some(0));
        self.rebuild_filter();
        self.refresh_inspector_preview();
    }

    fn move_selection(&mut self, delta: isize) {
        let len = self.filtered.len();
        if len == 0 {
            return;
        }
        let cur = self.table_state.selected().unwrap_or(0);
        let next = if delta >= 0 {
            (cur + delta.unsigned_abs()) % len
        } else {
            let step = delta.unsigned_abs() % len;
            (cur + len - step) % len
        };
        self.table_state.select(Some(next));
        self.show_last_result = false;
        self.inspect_scroll = 0;
        self.refresh_inspector_preview();
    }

    fn refresh_inspector_preview(&mut self) {
        if self.show_last_result {
            return;
        }
        let Some(row) = self.selected_filtered().cloned() else {
            self.inspect_title = " INSPECTOR ".into();
            self.inspect_body = if self.search_query.is_empty() {
                "No items in this view.".into()
            } else {
                format!("No match for \"{}\". Press Esc to clear filter.", self.search_query)
            };
            return;
        };
        match self.tab {
            0 => {
                if let Some(m) = self.entries.get(row.index).cloned() {
                    self.preview_bh_member(&m);
                }
            }
            1 => {
                if let Some(t) = self.tools.get(row.index) {
                    self.preview_tars_tool(&t.clone());
                }
            }
            2 => {
                if let Some(item) = self.catalog_items.get(row.index).cloned() {
                    match item {
                        CatalogItem::Tars(ti) => {
                            if let Some(t) = self.tools.get(ti).cloned() {
                                self.preview_tars_tool(&t);
                            }
                        }
                        CatalogItem::Bh(bi) => {
                            if let Some(m) = self.catalog_members.get(bi).cloned() {
                                self.preview_bh_member(&m);
                            }
                        }
                        CatalogItem::Action(ai) => {
                            if let Some(a) = self.actions.get(ai).cloned() {
                                self.preview_action(&a);
                            }
                        }
                    }
                }
            }
            3 => {
                if let Some(a) = self.actions.get(row.index).cloned() {
                    self.preview_action(&a);
                }
            }
            4 => {
                if let Some(h) = self.history.get(row.index) {
                    let badge = if h.ok { "OK" } else { "ERR" };
                    self.inspect_title = format!(" HISTORY · {badge} ({} ms) ", h.ms);
                    self.inspect_body = format!("{}\n\n{}", h.label, h.full_output);
                }
            }
            _ => {}
        }
    }

    fn preview_bh_member(&mut self, m: &BhMember) {
        self.inspect_title = format!(" __bh · {} ", m.kind.to_uppercase());
        let hint = match m.kind.as_str() {
            "fn" => "Press [Enter] to configure & CALL function · [x] quick-call",
            "obj" | "object" => "Press [Enter] to drill into object · [Bksp] up",
            "bool" | "num" | "str" => "Press [Enter] to EDIT/SET value · [Space] toggle bool",
            _ => "Press [Enter] to inspect live value",
        };
        let sig = if m.kind == "fn" {
            if m.fn_params.is_empty() {
                format!("__bh.{}()", m.path)
            } else {
                format!("__bh.{}({})", m.path, m.fn_params.join(", "))
            }
        } else {
            format!("__bh.{}", m.path)
        };
        self.inspect_body = format!("{sig}\nType: {}\nPreview: {}\n\n{hint}", m.kind, m.preview);
    }

    fn preview_tars_tool(&mut self, t: &TarsToolInfo) {
        self.inspect_title = format!(" TARS · {} ", t.name);
        let mut lines = vec![
            format!("Tool: {}", t.name),
            t.description.clone(),
            String::new(),
        ];
        if t.param_specs.is_empty() {
            lines.push("Parameters: (none — press Enter to run immediately)".into());
        } else {
            lines.push("Parameters:".into());
            for ps in &t.param_specs {
                let req = if ps.required { " [REQ]" } else { "" };
                let choices = if ps.choices.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", ps.choices.join("|"))
                };
                lines.push(format!("  • {}: {}{req}{choices}", ps.name, ps.kind));
                if !ps.description.is_empty() {
                    lines.push(format!("    {}", ps.description));
                }
            }
        }
        lines.push(String::new());
        lines.push("Press [Enter] to open interactive Runner Form.".into());
        self.inspect_body = lines.join("\n");
    }

    fn preview_action(&mut self, a: &QuickAction) {
        self.inspect_title = format!(" ACTION · {} ", a.category);
        let payload = match &a.exec {
            QuickExec::Tool { name, args } => format!("tool {name} {args}"),
            QuickExec::BhCall { path, args } => format!("__bh.{path}({args})"),
            QuickExec::BhEval { expr } => expr.clone(),
            QuickExec::Mcdu { action, arg } => {
                format!("mcdu {action} {}", arg.as_deref().unwrap_or(""))
            }
        };
        self.inspect_body = format!(
            "{}\n\n{}\n\nRPC: {payload}\n\nPress [Enter] to execute immediately.",
            a.title, a.description
        );
    }

    fn open_tars_modal(&mut self, tool: TarsToolInfo) {
        let fields: Vec<TarsFormField> = tool
            .param_specs
            .iter()
            .map(|spec| {
                let initial = if spec.required && !spec.choices.is_empty() {
                    spec.choices[0].clone()
                } else {
                    String::new()
                };
                TarsFormField {
                    spec: spec.clone(),
                    value: initial,
                }
            })
            .collect();
        self.modal = Modal::Tars(TarsModal {
            tool,
            fields,
            selected: 0,
            raw_mode: false,
            raw_json: "{}".into(),
            error: None,
        });
    }

    fn open_bh_call_modal(&mut self, m: &BhMember) {
        let count = m.fn_params.len().max(m.arity.unwrap_or(0));
        let mut labels = Vec::with_capacity(count);
        for i in 0..count {
            if let Some(lbl) = m.fn_params.get(i) {
                labels.push(lbl.clone());
            } else {
                labels.push(format!("arg{i}"));
            }
        }
        let values = vec![String::new(); labels.len()];
        self.modal = Modal::BhCall(BhCallModal {
            path: m.path.clone(),
            labels,
            values,
            selected: 0,
            raw_mode: false,
            raw_json: "[]".into(),
            error: None,
        });
    }

    fn open_bh_set_modal(&mut self, m: &BhMember) {
        let cur = if self.online {
            self.bus
                .bh_get(&m.path)
                .map_or_else(|| m.preview.clone(), |v| match v {
                    Value::String(s) => s,
                    other => other.to_string(),
                })
        } else {
            m.preview.clone()
        };
        self.modal = Modal::BhSet(BhSetModal {
            path: m.path.clone(),
            kind: m.kind.clone(),
            value: cur,
            error: None,
        });
    }

    fn record_result(&mut self, label: String, exec: QuickExec, res: Result<Value, String>, ms: u128) {
        match res {
            Ok(v) => {
                let pretty = pretty_json(&v);
                let summary = compact_summary(&v);
                self.inspect_title = format!(" ✓ RESULT ({ms} ms) ");
                self.inspect_body = format!("{label}\n\n{pretty}");
                self.inspect_scroll = 0;
                self.show_last_result = true;
                self.last_status = Some((true, format!("✓ {label} ({ms} ms)")));
                self.history.insert(
                    0,
                    HistoryEntry {
                        label,
                        ok: true,
                        ms,
                        summary,
                        full_output: pretty,
                        exec,
                    },
                );
            }
            Err(err) => {
                self.inspect_title = format!(" ✗ ERROR ({ms} ms) ");
                self.inspect_body = format!("{label}\n\nERROR:\n{err}");
                self.inspect_scroll = 0;
                self.show_last_result = true;
                self.last_status = Some((false, format!("✗ {label}: {err}")));
                self.history.insert(
                    0,
                    HistoryEntry {
                        label,
                        ok: false,
                        ms,
                        summary: err.clone(),
                        full_output: err,
                        exec,
                    },
                );
            }
        }
        if self.history.len() > 80 {
            self.history.truncate(80);
        }
        if self.tab == 4 {
            self.rebuild_filter();
        }
    }

    fn run_quick_exec(&mut self, label: String, exec: QuickExec) {
        let t0 = Instant::now();
        let res = if self.online {
            match &exec {
                QuickExec::Tool { name, args } => self.bus.tars_tool_result(name, args),
                QuickExec::BhCall { path, args } => self.bus.bh_call_result(path, args),
                QuickExec::BhEval { expr } => self.bus.bh_eval_result(expr),
                QuickExec::Mcdu { action, arg } => self
                    .bus
                    .mcdu(action, arg.as_deref())
                    .ok_or_else(|| "MCDU RPC failed (is A320 active?)".into()),
            }
        } else {
            Ok(json!({ "offline": true, "executed": label }))
        };
        self.record_result(label, exec, res, t0.elapsed().as_millis());
    }

    fn activate_bh_member(&mut self, m: BhMember, allow_drill: bool, quick: bool) {
        match m.kind.as_str() {
            "obj" | "object" if allow_drill => {
                self.bh_path = m.path;
                self.search_query.clear();
                self.tab = 0;
                self.reload_bh();
                self.inspect_title = format!(" __bh.{} ", self.bh_path);
                self.inspect_body = format!("Entered __bh.{} ({} members)", self.bh_path, self.entries.len());
            }
            "fn" => {
                if quick && m.arity == Some(0) && m.fn_params.is_empty() {
                    let label = format!("__bh.{}()", m.path);
                    self.run_quick_exec(
                        label,
                        QuickExec::BhCall {
                            path: m.path,
                            args: json!([]),
                        },
                    );
                } else {
                    self.open_bh_call_modal(&m);
                }
            }
            "bool" | "boolean" if quick => {
                let next_val = m.preview.trim() != "true";
                let t0 = Instant::now();
                let res = if self.online {
                    self.bus.bh_set_result(&m.path, &Value::Bool(next_val))
                } else {
                    Ok(Value::Bool(next_val))
                };
                let label = format!("__bh.{} = {next_val}", m.path);
                let exec = QuickExec::BhEval {
                    expr: format!("bh.{} = {next_val}", m.path),
                };
                self.record_result(label, exec, res, t0.elapsed().as_millis());
                if self.tab == 0 {
                    self.reload_bh();
                }
            }
            "bool" | "boolean" | "num" | "number" | "str" | "string" => {
                self.open_bh_set_modal(&m);
            }
            _ => {
                let t0 = Instant::now();
                let res = if self.online {
                    self.bus.bh_get_result(&m.path)
                } else {
                    Ok(json!({ "path": m.path, "preview": m.preview }))
                };
                let label = format!("get __bh.{}", m.path);
                let exec = QuickExec::BhEval {
                    expr: format!("bh.{}", m.path),
                };
                self.record_result(label, exec, res, t0.elapsed().as_millis());
            }
        }
    }

    fn activate_selected(&mut self, quick: bool) {
        let Some(row) = self.selected_filtered().cloned() else {
            return;
        };
        match self.tab {
            0 => {
                if let Some(m) = self.entries.get(row.index).cloned() {
                    self.activate_bh_member(m, true, quick);
                }
            }
            1 => {
                if let Some(t) = self.tools.get(row.index).cloned() {
                    if quick && t.param_specs.is_empty() {
                        let label = format!("tool {}", t.name);
                        self.run_quick_exec(
                            label,
                            QuickExec::Tool {
                                name: t.name,
                                args: json!({}),
                            },
                        );
                    } else {
                        self.open_tars_modal(t);
                    }
                }
            }
            2 => {
                if let Some(item) = self.catalog_items.get(row.index).cloned() {
                    match item {
                        CatalogItem::Action(ai) => {
                            if let Some(a) = self.actions.get(ai).cloned() {
                                self.run_quick_exec(a.title.into(), a.exec);
                            }
                        }
                        CatalogItem::Tars(ti) => {
                            if let Some(t) = self.tools.get(ti).cloned() {
                                self.open_tars_modal(t);
                            }
                        }
                        CatalogItem::Bh(bi) => {
                            if let Some(m) = self.catalog_members.get(bi).cloned() {
                                self.activate_bh_member(m, true, quick);
                            }
                        }
                    }
                }
            }
            3 => {
                if let Some(a) = self.actions.get(row.index).cloned() {
                    self.run_quick_exec(a.title.into(), a.exec);
                }
            }
            4 => {
                if let Some(h) = self.history.get(row.index).cloned() {
                    self.run_quick_exec(h.label, h.exec);
                }
            }
            _ => {}
        }
    }

    fn submit_tars_modal(&mut self) {
        let Modal::Tars(mut form) = std::mem::replace(&mut self.modal, Modal::None) else {
            return;
        };
        let parsed: Result<Value, String> = if form.raw_mode {
            let trimmed = form.raw_json.trim();
            if trimmed.is_empty() {
                Ok(json!({}))
            } else {
                serde_json::from_str::<Value>(trimmed).map_err(|e| format!("Invalid JSON: {e}"))
            }
        } else {
            let mut map = Map::new();
            let mut err: Option<String> = None;
            for f in &form.fields {
                let v = f.value.trim();
                if v.is_empty() {
                    if f.spec.required {
                        err = Some(format!("Missing required parameter: {}", f.spec.name));
                        break;
                    }
                    continue;
                }
                match parse_smart_value(v, &f.spec.kind) {
                    Ok(jv) => {
                        map.insert(f.spec.name.clone(), jv);
                    }
                    Err(e) => {
                        err = Some(format!("{}: {e}", f.spec.name));
                        break;
                    }
                }
            }
            if let Some(e) = err {
                Err(e)
            } else {
                Ok(Value::Object(map))
            }
        };

        let args = match parsed {
            Ok(a) => a,
            Err(e) => {
                form.error = Some(e);
                self.modal = Modal::Tars(form);
                return;
            }
        };

        let t0 = Instant::now();
        let res = if self.online {
            self.bus.tars_tool_result(&form.tool.name, &args)
        } else {
            Ok(json!({ "offline": true, "tool": form.tool.name, "args": args }))
        };
        let ms = t0.elapsed().as_millis();
        match res {
            Ok(v) => {
                let label = format!("tool {}", form.tool.name);
                let exec = QuickExec::Tool {
                    name: form.tool.name,
                    args,
                };
                self.record_result(label, exec, Ok(v), ms);
            }
            Err(e) => {
                form.error = Some(e.clone());
                self.last_status = Some((false, format!("✗ {}: {e}", form.tool.name)));
                self.modal = Modal::Tars(form);
            }
        }
    }

    fn submit_bh_call_modal(&mut self) {
        let Modal::BhCall(mut form) = std::mem::replace(&mut self.modal, Modal::None) else {
            return;
        };
        let parsed: Result<Value, String> = if form.raw_mode {
            let trimmed = form.raw_json.trim();
            if trimmed.is_empty() {
                Ok(json!([]))
            } else {
                serde_json::from_str::<Value>(trimmed)
                    .map_err(|e| format!("Invalid JSON array: {e}"))
                    .and_then(|v| {
                        if v.is_array() {
                            Ok(v)
                        } else {
                            Err("Raw mode expects a JSON array [...]".into())
                        }
                    })
            }
        } else {
            // Trim trailing empty optional arguments
            let mut last_non_empty = 0usize;
            for (i, v) in form.values.iter().enumerate() {
                if !v.trim().is_empty() {
                    last_non_empty = i + 1;
                }
            }
            let mut arr = Vec::with_capacity(last_non_empty);
            let mut err = None;
            for (i, raw) in form.values.iter().take(last_non_empty).enumerate() {
                match parse_smart_value(raw, "auto") {
                    Ok(v) => arr.push(v),
                    Err(e) => {
                        err = Some(format!("arg{i}: {e}"));
                        break;
                    }
                }
            }
            if let Some(e) = err {
                Err(e)
            } else {
                Ok(Value::Array(arr))
            }
        };

        let args = match parsed {
            Ok(a) => a,
            Err(e) => {
                form.error = Some(e);
                self.modal = Modal::BhCall(form);
                return;
            }
        };

        let t0 = Instant::now();
        let res = if self.online {
            self.bus.bh_call_result(&form.path, &args)
        } else {
            Ok(json!({ "offline": true, "call": form.path, "args": args }))
        };
        let ms = t0.elapsed().as_millis();
        match res {
            Ok(v) => {
                let label = format!("__bh.{}()", form.path);
                let exec = QuickExec::BhCall {
                    path: form.path,
                    args,
                };
                self.record_result(label, exec, Ok(v), ms);
            }
            Err(e) => {
                form.error = Some(e.clone());
                self.last_status = Some((false, format!("✗ __bh.{}: {e}", form.path)));
                self.modal = Modal::BhCall(form);
            }
        }
    }

    fn submit_bh_set_modal(&mut self) {
        let Modal::BhSet(mut form) = std::mem::replace(&mut self.modal, Modal::None) else {
            return;
        };
        let val = match parse_smart_value(&form.value, &form.kind) {
            Ok(v) => v,
            Err(e) => {
                form.error = Some(e);
                self.modal = Modal::BhSet(form);
                return;
            }
        };
        let t0 = Instant::now();
        let res = if self.online {
            self.bus.bh_set_result(&form.path, &val)
        } else {
            Ok(val.clone())
        };
        let ms = t0.elapsed().as_millis();
        match res {
            Ok(v) => {
                let label = format!("__bh.{} = {val}", form.path);
                let exec = QuickExec::BhEval {
                    expr: format!("bh.{} = {val}", form.path),
                };
                self.record_result(label, exec, Ok(v), ms);
                if self.tab == 0 {
                    self.reload_bh();
                }
            }
            Err(e) => {
                form.error = Some(e.clone());
                self.modal = Modal::BhSet(form);
            }
        }
    }

    fn submit_eval_bar(&mut self) {
        let cmd = self.eval_input.trim().to_string();
        self.focus = InputFocus::Normal;
        self.eval_hist_idx = None;
        if cmd.is_empty() {
            return;
        }
        if self.eval_history.first().map(String::as_str) != Some(cmd.as_str()) {
            self.eval_history.insert(0, cmd.clone());
            if self.eval_history.len() > 40 {
                self.eval_history.truncate(40);
            }
        }
        self.eval_input.clear();

        // Support `tool <name> [json]` shorthand inside the command bar
        if let Some(rest) = cmd.strip_prefix("tool ") {
            let mut parts = rest.trim().splitn(2, char::is_whitespace);
            let name = parts.next().unwrap_or("").trim().to_string();
            let raw_args = parts.next().unwrap_or("{}").trim();
            match serde_json::from_str::<Value>(if raw_args.is_empty() { "{}" } else { raw_args }) {
                Ok(args) => {
                    self.run_quick_exec(format!("tool {name}"), QuickExec::Tool { name, args });
                }
                Err(e) => {
                    self.record_result(
                        format!("tool {name}"),
                        QuickExec::BhEval { expr: cmd },
                        Err(format!("Invalid JSON args: {e}")),
                        0,
                    );
                }
            }
            return;
        }

        // Support `set <path> <val>` shorthand
        if let Some(rest) = cmd.strip_prefix("set ") {
            let mut parts = rest.trim().splitn(2, char::is_whitespace);
            if let (Some(path), Some(val_str)) = (parts.next(), parts.next()) {
                let expr = format!("bh.{path} = {val_str}");
                self.run_quick_exec(expr.clone(), QuickExec::BhEval { expr });
                return;
            }
        }

        self.run_quick_exec(cmd.clone(), QuickExec::BhEval { expr: cmd });
    }

    fn handle_modal_key(&mut self, key: KeyEvent) {
        if key.code == KeyCode::Esc {
            self.modal = Modal::None;
            return;
        }
        match &mut self.modal {
            Modal::None => {}
            Modal::Tars(form) => {
                if key.code == KeyCode::Char('e') && key.modifiers.contains(KeyModifiers::CONTROL) {
                    if !form.raw_mode {
                        let mut map = Map::new();
                        for f in &form.fields {
                            if !f.value.trim().is_empty()
                                && let Ok(v) = parse_smart_value(&f.value, &f.spec.kind)
                            {
                                map.insert(f.spec.name.clone(), v);
                            }
                        }
                        form.raw_json = serde_json::to_string(&Value::Object(map))
                            .unwrap_or_else(|_| "{}".into());
                    }
                    form.raw_mode = !form.raw_mode;
                    form.error = None;
                    return;
                }
                if key.code == KeyCode::Enter
                    || (key.code == KeyCode::Char('r') && key.modifiers.contains(KeyModifiers::CONTROL))
                {
                    self.submit_tars_modal();
                    return;
                }
                if form.raw_mode {
                    match key.code {
                        KeyCode::Backspace => {
                            form.raw_json.pop();
                        }
                        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            form.raw_json.clear();
                        }
                        KeyCode::Char(c) => form.raw_json.push(c),
                        _ => {}
                    }
                    return;
                }
                let n = form.fields.len();
                if n == 0 {
                    return;
                }
                match key.code {
                    KeyCode::Down | KeyCode::Tab => {
                        form.selected = (form.selected + 1) % n;
                    }
                    KeyCode::Up | KeyCode::BackTab => {
                        form.selected = if form.selected == 0 { n - 1 } else { form.selected - 1 };
                    }
                    KeyCode::Left | KeyCode::Right => {
                        let dir: isize = if key.code == KeyCode::Right { 1 } else { -1 };
                        cycle_tars_field(&mut form.fields[form.selected], dir);
                        form.error = None;
                    }
                    KeyCode::Char(' ') => {
                        let field = &mut form.fields[form.selected];
                        if !field.spec.choices.is_empty() || field.spec.kind == "boolean" {
                            cycle_tars_field(field, 1);
                            form.error = None;
                        } else {
                            field.value.push(' ');
                        }
                    }
                    KeyCode::Backspace => {
                        form.fields[form.selected].value.pop();
                    }
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        form.fields[form.selected].value.clear();
                    }
                    KeyCode::Char(c) => {
                        form.fields[form.selected].value.push(c);
                        form.error = None;
                    }
                    _ => {}
                }
            }
            Modal::BhCall(form) => {
                if key.code == KeyCode::Char('e') && key.modifiers.contains(KeyModifiers::CONTROL) {
                    form.raw_mode = !form.raw_mode;
                    form.error = None;
                    return;
                }
                if key.code == KeyCode::Char('a') && key.modifiers.contains(KeyModifiers::CONTROL) {
                    let idx = form.labels.len();
                    form.labels.push(format!("arg{idx}"));
                    form.values.push(String::new());
                    form.selected = idx;
                    return;
                }
                if key.code == KeyCode::Enter {
                    self.submit_bh_call_modal();
                    return;
                }
                if form.raw_mode {
                    match key.code {
                        KeyCode::Backspace => {
                            form.raw_json.pop();
                        }
                        KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                            form.raw_json.clear();
                        }
                        KeyCode::Char(c) => form.raw_json.push(c),
                        _ => {}
                    }
                    return;
                }
                if form.values.is_empty() {
                    if let KeyCode::Char(c) = key.code {
                        form.labels.push("arg0".into());
                        form.values.push(c.to_string());
                        form.selected = 0;
                    }
                    return;
                }
                let n = form.values.len();
                match key.code {
                    KeyCode::Down | KeyCode::Tab => form.selected = (form.selected + 1) % n,
                    KeyCode::Up | KeyCode::BackTab => {
                        form.selected = if form.selected == 0 { n - 1 } else { form.selected - 1 };
                    }
                    KeyCode::Backspace => {
                        form.values[form.selected].pop();
                    }
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        form.values[form.selected].clear();
                    }
                    KeyCode::Char(c) => {
                        form.values[form.selected].push(c);
                        form.error = None;
                    }
                    _ => {}
                }
            }
            Modal::BhSet(form) => match key.code {
                KeyCode::Enter => self.submit_bh_set_modal(),
                KeyCode::Left | KeyCode::Right | KeyCode::Char(' ')
                    if form.kind == "bool" || form.kind == "boolean" =>
                {
                    form.value = if form.value.trim() == "true" {
                        "false".into()
                    } else {
                        "true".into()
                    };
                    form.error = None;
                }
                KeyCode::Backspace => {
                    form.value.pop();
                }
                KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    form.value.clear();
                }
                KeyCode::Char(c) => {
                    form.value.push(c);
                    form.error = None;
                }
                _ => {}
            },
        }
    }

    fn handle_search_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                if self.search_query.is_empty() {
                    self.focus = InputFocus::Normal;
                } else {
                    self.search_query.clear();
                    self.rebuild_filter();
                    self.refresh_inspector_preview();
                    self.focus = InputFocus::Normal;
                }
            }
            KeyCode::Enter => {
                self.focus = InputFocus::Normal;
                self.activate_selected(false);
            }
            KeyCode::Down => self.move_selection(1),
            KeyCode::Up => self.move_selection(-1),
            KeyCode::Tab => {
                // Promote inline search straight to FUZZY ALL when searching from another tab
                if self.tab == 2 {
                    self.move_selection(1);
                } else {
                    self.tab = 2;
                    self.table_state.select(Some(0));
                    self.rebuild_filter();
                    self.refresh_inspector_preview();
                }
            }
            KeyCode::Backspace => {
                self.search_query.pop();
                self.table_state.select(Some(0));
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.search_query.clear();
                self.table_state.select(Some(0));
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            KeyCode::Char(c) => {
                self.search_query.push(c);
                self.table_state.select(Some(0));
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            _ => {}
        }
    }

    fn handle_eval_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.focus = InputFocus::Normal;
                self.eval_hist_idx = None;
            }
            KeyCode::Enter => self.submit_eval_bar(),
            KeyCode::Up => {
                if !self.eval_history.is_empty() {
                    let next = self
                        .eval_hist_idx
                        .map_or(0, |i| (i + 1).min(self.eval_history.len() - 1));
                    self.eval_hist_idx = Some(next);
                    self.eval_input = self.eval_history[next].clone();
                }
            }
            KeyCode::Down => {
                if let Some(i) = self.eval_hist_idx {
                    if i == 0 {
                        self.eval_hist_idx = None;
                        self.eval_input.clear();
                    } else {
                        self.eval_hist_idx = Some(i - 1);
                        self.eval_input = self.eval_history[i - 1].clone();
                    }
                }
            }
            KeyCode::Backspace => {
                self.eval_input.pop();
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.eval_input.clear();
            }
            KeyCode::Char(c) => self.eval_input.push(c),
            _ => {}
        }
    }

    fn draw_header(&self, frame: &mut Frame, area: Rect) {
        let t = self.bus.cached();
        let tab_titles = vec![
            Line::from(format!(" 1:__bh ({}) ", self.entries.len())),
            Line::from(format!(" 2:TARS ({}) ", self.tools.len())),
            Line::from(format!(" 3:FUZZY ({}) ", self.catalog_items.len())),
            Line::from(format!(" 4:ACT ({}) ", self.actions.len())),
            Line::from(format!(" 5:LOG ({}) ", self.history.len())),
        ];
        let tabs = Tabs::new(tab_titles)
            .select(self.tab)
            .block(
                Block::default()
                    .title(format!(
                        " BH-TUI [AAA COMMAND CENTER] · {} @ {} · HDG {:03.0}° ",
                        t.vessel_id.to_uppercase(),
                        t.body.to_uppercase(),
                        t.heading_wrapped()
                    ))
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(C_CYN)),
            )
            .style(Style::default().fg(C_DIM))
            .highlight_style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD));
        frame.render_widget(tabs, area);
    }

    fn draw_search_bar(&self, frame: &mut Frame, area: Rect) {
        let active = self.focus == InputFocus::Search;
        let scope = match self.tab {
            0 => "__bh",
            1 => "TARS",
            2 => "ALL (TARS + __bh + ACTIONS)",
            3 => "ACTIONS",
            _ => "HISTORY",
        };
        let cursor = if active { "█" } else { "" };
        let label_style = if active {
            Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(C_CYN)
        };
        let query_line = if self.search_query.is_empty() && !active {
            Line::from(vec![
                Span::styled(" / FUZZY ", label_style),
                Span::styled(
                    format!("Type / to filter {scope} · Ctrl+P or f for global palette · : to eval"),
                    Style::default().fg(C_DIM),
                ),
            ])
        } else {
            Line::from(vec![
                Span::styled(format!(" / FUZZY [{scope}] "), label_style),
                Span::styled(
                    format!("{}{cursor}", self.search_query),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!("   ({} hits)", self.filtered.len()),
                    Style::default().fg(C_GRN),
                ),
            ])
        };
        let border_col = if active { C_AMB } else { C_DIM };
        let bar = Paragraph::new(query_line).block(
            Block::default()
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(border_col)),
        );
        frame.render_widget(bar, area);
    }

    fn draw_left_pane(&mut self, frame: &mut Frame, area: Rect) {
        let hi_style = Style::default().fg(C_AMB).add_modifier(Modifier::BOLD);
        match self.tab {
            0 => {
                let rows: Vec<Row> = self
                    .filtered
                    .iter()
                    .filter_map(|fr| {
                        let m = self.entries.get(fr.index)?;
                        let name_spans = highlight_spans(
                            &m.name,
                            &fr.positions,
                            24,
                            Style::default().fg(Color::White),
                            hi_style,
                        );
                        Some(Row::new(vec![
                            Cell::from(Line::from(name_spans)),
                            Cell::from(m.kind.as_str()).style(Style::default().fg(kind_color(&m.kind))),
                            Cell::from(m.preview.chars().take(34).collect::<String>())
                                .style(Style::default().fg(C_DIM)),
                        ]))
                    })
                    .collect();
                let title = if self.bh_path.is_empty() {
                    " __bh (root) · [Enter] Open/Run/Edit ".to_string()
                } else {
                    format!(" __bh.{} · [Bksp] Up ", self.bh_path)
                };
                let table = Table::new(
                    rows,
                    [
                        Constraint::Length(22),
                        Constraint::Length(6),
                        Constraint::Min(10),
                    ],
                )
                .header(
                    Row::new(["MEMBER", "TYPE", "SIGNATURE / PREVIEW"])
                        .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                )
                .block(
                    Block::default()
                        .title(title)
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(C_CYN)),
                )
                .row_highlight_style(
                    Style::default()
                        .bg(C_SEL_BG)
                        .fg(C_GRN)
                        .add_modifier(Modifier::BOLD),
                );
                frame.render_stateful_widget(table, area, &mut self.table_state);
            }
            1 => {
                let rows: Vec<Row> = self
                    .filtered
                    .iter()
                    .filter_map(|fr| {
                        let t = self.tools.get(fr.index)?;
                        let name_spans = highlight_spans(
                            &t.name,
                            &fr.positions,
                            20,
                            Style::default().fg(C_GRN),
                            hi_style,
                        );
                        let pcount = if t.param_specs.is_empty() {
                            "()".into()
                        } else {
                            format!("({}p)", t.param_specs.len())
                        };
                        Some(Row::new(vec![
                            Cell::from(Line::from(name_spans)),
                            Cell::from(pcount).style(Style::default().fg(C_CYN)),
                            Cell::from(t.description.chars().take(46).collect::<String>())
                                .style(Style::default().fg(Color::White)),
                        ]))
                    })
                    .collect();
                let table = Table::new(
                    rows,
                    [
                        Constraint::Length(18),
                        Constraint::Length(5),
                        Constraint::Min(12),
                    ],
                )
                .header(
                    Row::new(["TARS TOOL", "ARGS", "DESCRIPTION"])
                        .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                )
                .block(
                    Block::default()
                        .title(" TARS TOOLS · [Enter] Run Tool ")
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(C_GRN)),
                )
                .row_highlight_style(
                    Style::default()
                        .bg(C_SEL_BG)
                        .fg(C_AMB)
                        .add_modifier(Modifier::BOLD),
                );
                frame.render_stateful_widget(table, area, &mut self.table_state);
            }
            2 => {
                let rows: Vec<Row> = self
                    .filtered
                    .iter()
                    .take(120)
                    .filter_map(|fr| {
                        let item = self.catalog_items.get(fr.index)?;
                        let (badge, bcol, primary, detail) = match *item {
                            CatalogItem::Action(ai) => {
                                let a = &self.actions[ai];
                                ("ACT", C_AMB, a.title.to_string(), a.description.to_string())
                            }
                            CatalogItem::Tars(ti) => {
                                let t = &self.tools[ti];
                                ("TARS", C_GRN, t.name.clone(), t.description.clone())
                            }
                            CatalogItem::Bh(bi) => {
                                let m = &self.catalog_members[bi];
                                let tag = if m.kind == "fn" { "FN" } else { "PROP" };
                                (tag, kind_color(&m.kind), m.path.clone(), m.preview.clone())
                            }
                        };
                        let name_spans = highlight_spans(
                            &primary,
                            &fr.positions,
                            28,
                            Style::default().fg(Color::White),
                            hi_style,
                        );
                        Some(Row::new(vec![
                            Cell::from(badge).style(Style::default().fg(bcol).add_modifier(Modifier::BOLD)),
                            Cell::from(Line::from(name_spans)),
                            Cell::from(detail.chars().take(36).collect::<String>())
                                .style(Style::default().fg(C_DIM)),
                        ]))
                    })
                    .collect();
                let table = Table::new(
                    rows,
                    [
                        Constraint::Length(5),
                        Constraint::Length(26),
                        Constraint::Min(10),
                    ],
                )
                .header(
                    Row::new(["KIND", "FEATURE / FUNCTION", "DETAIL"])
                        .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                )
                .block(
                    Block::default()
                        .title(format!(
                            " FUZZY COMMAND PALETTE ({}/{}) · [Enter] Launch ",
                            self.filtered.len(),
                            self.catalog_items.len()
                        ))
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(C_AMB)),
                )
                .row_highlight_style(
                    Style::default()
                        .bg(C_SEL_BG)
                        .fg(C_GRN)
                        .add_modifier(Modifier::BOLD),
                );
                frame.render_stateful_widget(table, area, &mut self.table_state);
            }
            3 => {
                let rows: Vec<Row> = self
                    .filtered
                    .iter()
                    .filter_map(|fr| {
                        let a = self.actions.get(fr.index)?;
                        let title_spans = highlight_spans(
                            a.title,
                            &fr.positions,
                            30,
                            Style::default().fg(Color::White),
                            hi_style,
                        );
                        Some(Row::new(vec![
                            Cell::from(a.category).style(Style::default().fg(C_CYN).add_modifier(Modifier::BOLD)),
                            Cell::from(Line::from(title_spans)),
                            Cell::from(a.description.chars().take(34).collect::<String>())
                                .style(Style::default().fg(C_DIM)),
                        ]))
                    })
                    .collect();
                let table = Table::new(
                    rows,
                    [
                        Constraint::Length(8),
                        Constraint::Length(28),
                        Constraint::Min(10),
                    ],
                )
                .header(
                    Row::new(["GROUP", "ACTION", "EFFECT"])
                        .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                )
                .block(
                    Block::default()
                        .title(" QUICK ACTIONS DECK · [Enter] Execute Now ")
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(C_MAG)),
                )
                .row_highlight_style(
                    Style::default()
                        .bg(C_SEL_BG)
                        .fg(C_AMB)
                        .add_modifier(Modifier::BOLD),
                );
                frame.render_stateful_widget(table, area, &mut self.table_state);
            }
            _ => {
                if self.show_telemetry_in_log {
                    let txt = serde_json::to_string_pretty(self.bus.cached()).unwrap_or_default();
                    let para = Paragraph::new(txt).wrap(Wrap { trim: false }).block(
                        Block::default()
                            .title(" /obc/telemetry.json · [t] History ")
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(C_CYN)),
                    );
                    frame.render_widget(para, area);
                } else {
                    let rows: Vec<Row> = self
                        .filtered
                        .iter()
                        .filter_map(|fr| {
                            let h = self.history.get(fr.index)?;
                            let st = if h.ok { "OK" } else { "ERR" };
                            let col = if h.ok { C_GRN } else { C_RED };
                            Some(Row::new(vec![
                                Cell::from(st).style(Style::default().fg(col).add_modifier(Modifier::BOLD)),
                                Cell::from(h.label.chars().take(24).collect::<String>())
                                    .style(Style::default().fg(Color::White)),
                                Cell::from(format!("{}ms", h.ms)).style(Style::default().fg(C_DIM)),
                                Cell::from(h.summary.chars().take(26).collect::<String>())
                                    .style(Style::default().fg(C_CYN)),
                            ]))
                        })
                        .collect();
                    let table = Table::new(
                        rows,
                        [
                            Constraint::Length(4),
                            Constraint::Length(24),
                            Constraint::Length(6),
                            Constraint::Min(8),
                        ],
                    )
                    .header(
                        Row::new(["ST", "INVOCATION", "TIME", "RESULT"])
                            .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                    )
                    .block(
                        Block::default()
                            .title(" EXECUTION HISTORY · [Enter] Re-Run · [t] Telemetry ")
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(C_CYN)),
                    )
                    .row_highlight_style(
                        Style::default()
                            .bg(C_SEL_BG)
                            .fg(C_GRN)
                            .add_modifier(Modifier::BOLD),
                    );
                    frame.render_stateful_widget(table, area, &mut self.table_state);
                }
            }
        }
    }

    fn draw_inspector(&self, frame: &mut Frame, area: Rect) {
        let border_col = if self.show_last_result {
            if self.last_status.as_ref().is_some_and(|(ok, _)| *ok) {
                C_GRN
            } else {
                C_RED
            }
        } else {
            C_DIM
        };
        let inspector = Paragraph::new(self.inspect_body.as_str())
            .wrap(Wrap { trim: false })
            .scroll((self.inspect_scroll, 0))
            .block(
                Block::default()
                    .title(self.inspect_title.as_str())
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(border_col)),
            );
        frame.render_widget(inspector, area);
    }

    fn draw_modal(&self, frame: &mut Frame) {
        match &self.modal {
            Modal::None => {}
            Modal::Tars(form) => {
                let area = centered_rect(82, 76, frame.area());
                frame.render_widget(Clear, area);
                let mut lines: Vec<Line> = vec![
                    Line::from(Span::styled(
                        form.tool.description.clone(),
                        Style::default().fg(C_DIM),
                    )),
                    Line::from(""),
                ];
                if form.raw_mode {
                    lines.push(Line::from(Span::styled(
                        "Raw JSON arguments (Ctrl+E for form mode):",
                        Style::default().fg(C_AMB).add_modifier(Modifier::BOLD),
                    )));
                    lines.push(Line::from(Span::styled(
                        format!("> {}█", form.raw_json),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    )));
                } else if form.fields.is_empty() {
                    lines.push(Line::from(Span::styled(
                        "This tool takes no parameters. Press [Enter] to run immediately!",
                        Style::default().fg(C_GRN).add_modifier(Modifier::BOLD),
                    )));
                } else {
                    for (i, f) in form.fields.iter().enumerate() {
                        let focused = i == form.selected;
                        let marker = if focused { "▸ " } else { "  " };
                        let req = if f.spec.required { "*" } else { " " };
                        let display_val = if f.value.is_empty() {
                            if focused { "█".to_string() } else { "<unset>".into() }
                        } else if focused {
                            format!("{}█", f.value)
                        } else {
                            f.value.clone()
                        };
                        let val_style = if focused {
                            Style::default().bg(C_SEL_BG).fg(C_AMB).add_modifier(Modifier::BOLD)
                        } else if f.value.is_empty() {
                            Style::default().fg(C_DIM)
                        } else {
                            Style::default().fg(C_GRN)
                        };
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("{marker}{req}{:<14}", f.spec.name),
                                Style::default().fg(if focused { C_CYN } else { Color::White }),
                            ),
                            Span::styled(format!("[{:<6}] ", f.spec.kind), Style::default().fg(C_DIM)),
                            Span::styled(display_val, val_style),
                        ]));
                    }
                    if let Some(cur) = form.fields.get(form.selected) {
                        lines.push(Line::from(""));
                        let mut hint = cur.spec.description.clone();
                        if !cur.spec.choices.is_empty() {
                            if !hint.is_empty() {
                                hint.push_str(" · ");
                            }
                            hint.push_str("←/→ choices: ");
                            hint.push_str(&cur.spec.choices.join(" | "));
                        } else if cur.spec.kind == "boolean" {
                            hint.push_str(" (Space/←/→ toggles true/false/unset)");
                        } else if cur.spec.min.is_some() || cur.spec.max.is_some() {
                            let lo = cur.spec.min.map_or_else(|| "-∞".into(), |v| format!("{v}"));
                            let hi = cur.spec.max.map_or_else(|| "+∞".into(), |v| format!("{v}"));
                            let _ = write!(hint, " [range {lo}..{hi}]");
                        }
                        lines.push(Line::from(Span::styled(hint, Style::default().fg(C_CYN))));
                    }
                }
                if let Some(err) = &form.error {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(
                        format!("✗ {err}"),
                        Style::default().fg(C_RED).add_modifier(Modifier::BOLD),
                    )));
                }
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "[Enter] Run  [↑/↓/Tab] Field  [←/→/Space] Enum/Bool  [Ctrl+E] Raw JSON  [Esc] Cancel",
                    Style::default().fg(C_AMB),
                )));
                let modal = Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .style(Style::default().bg(C_MODAL_BG))
                    .block(
                        Block::default()
                            .title(format!(" RUN TARS TOOL · {} ", form.tool.name))
                            .borders(Borders::ALL)
                            .border_type(BorderType::Double)
                            .border_style(Style::default().fg(C_GRN))
                            .style(Style::default().bg(C_MODAL_BG)),
                    );
                frame.render_widget(modal, area);
            }
            Modal::BhCall(form) => {
                let area = centered_rect(78, 66, frame.area());
                frame.render_widget(Clear, area);
                let mut lines: Vec<Line> = vec![
                    Line::from(Span::styled(
                        format!("Invoke __bh.{}({})", form.path, form.labels.join(", ")),
                        Style::default().fg(C_CYN).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                ];
                if form.raw_mode {
                    lines.push(Line::from(Span::styled(
                        "Raw JSON argument array (e.g. [\"f35\", {\"alt\": 1000}]):",
                        Style::default().fg(C_AMB),
                    )));
                    lines.push(Line::from(Span::styled(
                        format!("> {}█", form.raw_json),
                        Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                    )));
                } else if form.values.is_empty() {
                    lines.push(Line::from(Span::styled(
                        "0 arguments. Press [Enter] to call now, or [Ctrl+A] to add an argument.",
                        Style::default().fg(C_GRN),
                    )));
                } else {
                    for (i, lbl) in form.labels.iter().enumerate() {
                        let focused = i == form.selected;
                        let marker = if focused { "▸ " } else { "  " };
                        let val = form.values.get(i).map_or("", String::as_str);
                        let shown = if focused {
                            format!("{val}█")
                        } else if val.is_empty() {
                            "<empty>".into()
                        } else {
                            val.to_string()
                        };
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("{marker}{lbl:<16} = "),
                                Style::default().fg(if focused { C_CYN } else { Color::White }),
                            ),
                            Span::styled(
                                shown,
                                if focused {
                                    Style::default().bg(C_SEL_BG).fg(C_AMB).add_modifier(Modifier::BOLD)
                                } else {
                                    Style::default().fg(C_GRN)
                                },
                            ),
                        ]));
                    }
                }
                if let Some(err) = &form.error {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(
                        format!("✗ {err}"),
                        Style::default().fg(C_RED).add_modifier(Modifier::BOLD),
                    )));
                }
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "[Enter] Call  [↑/↓/Tab] Arg  [Ctrl+A] Add Arg  [Ctrl+E] Raw JSON  [Esc] Cancel",
                    Style::default().fg(C_AMB),
                )));
                let modal = Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .style(Style::default().bg(C_MODAL_BG))
                    .block(
                        Block::default()
                            .title(format!(" CALL __bh.{} ", form.path))
                            .borders(Borders::ALL)
                            .border_type(BorderType::Double)
                            .border_style(Style::default().fg(C_CYN))
                            .style(Style::default().bg(C_MODAL_BG)),
                    );
                frame.render_widget(modal, area);
            }
            Modal::BhSet(form) => {
                let area = centered_rect(72, 46, frame.area());
                frame.render_widget(Clear, area);
                let mut lines: Vec<Line> = vec![
                    Line::from(Span::styled(
                        format!("Property: __bh.{} ({})", form.path, form.kind),
                        Style::default().fg(C_CYN).add_modifier(Modifier::BOLD),
                    )),
                    Line::from(""),
                    Line::from(vec![
                        Span::styled("Value: ", Style::default().fg(C_AMB)),
                        Span::styled(
                            format!("{}█", form.value),
                            Style::default().bg(C_SEL_BG).fg(Color::White).add_modifier(Modifier::BOLD),
                        ),
                    ]),
                ];
                if let Some(err) = &form.error {
                    lines.push(Line::from(""));
                    lines.push(Line::from(Span::styled(
                        format!("✗ {err}"),
                        Style::default().fg(C_RED).add_modifier(Modifier::BOLD),
                    )));
                }
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "[Enter] Apply & Refresh  [Space] Toggle Bool  [Ctrl+U] Clear  [Esc] Cancel",
                    Style::default().fg(C_AMB),
                )));
                let modal = Paragraph::new(lines)
                    .wrap(Wrap { trim: false })
                    .style(Style::default().bg(C_MODAL_BG))
                    .block(
                        Block::default()
                            .title(format!(" SET __bh.{} ", form.path))
                            .borders(Borders::ALL)
                            .border_type(BorderType::Double)
                            .border_style(Style::default().fg(C_AMB))
                            .style(Style::default().bg(C_MODAL_BG)),
                    );
                frame.render_widget(modal, area);
            }
        }
    }

    fn draw_footer(&self, frame: &mut Frame, area: Rect) {
        if self.focus == InputFocus::EvalBar {
            let line = Line::from(vec![
                Span::styled(" :EVAL ", Style::default().bg(C_AMB).fg(Color::Black).add_modifier(Modifier::BOLD)),
                Span::styled(
                    format!(" {}█", self.eval_input),
                    Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
                ),
                Span::styled("   [Enter] Run  [↑/↓] Hist  [Esc] Cancel", Style::default().fg(C_DIM)),
            ]);
            frame.render_widget(Paragraph::new(line), area);
            return;
        }
        let mut spans = vec![
            Span::styled(" [↑↓←→] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Nav "),
            Span::styled("[/] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Fuzzy "),
            Span::styled("[f] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("All "),
            Span::styled("[Enter] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Run "),
            Span::styled("[:] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Eval "),
            Span::styled("[q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Quit"),
        ];
        if let Some((ok, msg)) = &self.last_status {
            spans.push(Span::raw("  "));
            spans.push(Span::styled(
                msg.chars().take(34).collect::<String>(),
                Style::default().fg(if *ok { C_GRN } else { C_RED }),
            ));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
    }
}

fn cycle_tars_field(field: &mut TarsFormField, dir: isize) {
    if !field.spec.choices.is_empty() {
        let mut opts: Vec<String> = Vec::new();
        if !field.spec.required {
            opts.push(String::new());
        }
        opts.extend(field.spec.choices.iter().cloned());
        let cur = opts.iter().position(|o| o == &field.value).unwrap_or(0);
        let len = opts.len();
        let next = if dir >= 0 {
            (cur + 1) % len
        } else {
            (cur + len - 1) % len
        };
        field.value = opts[next].clone();
    } else if field.spec.kind == "boolean" {
        field.value = match field.value.trim() {
            "" => "true".into(),
            "true" => "false".into(),
            _ if field.spec.required => "true".into(),
            _ => String::new(),
        };
    }
}

impl Default for BhTuiApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for BhTuiApp {
    fn tick(&mut self) {
        if self.online {
            let _ = self.bus.telemetry();
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        if !matches!(self.modal, Modal::None) {
            self.handle_modal_key(key);
            return false;
        }
        match self.focus {
            InputFocus::Search => {
                self.handle_search_key(key);
                return false;
            }
            InputFocus::EvalBar => {
                self.handle_eval_key(key);
                return false;
            }
            InputFocus::Normal => {}
        }

        // Global Ctrl+P / Ctrl+F opens Global Fuzzy Command Palette
        if key.modifiers.contains(KeyModifiers::CONTROL)
            && matches!(key.code, KeyCode::Char('p' | 'f'))
        {
            self.tab = 2;
            self.focus = InputFocus::Search;
            self.rebuild_filter();
            self.refresh_inspector_preview();
            return false;
        }

        match key.code {
            KeyCode::Char('q' | 'Q') => return true,
            KeyCode::Esc => {
                if self.search_query.is_empty() {
                    return true;
                }
                self.search_query.clear();
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            KeyCode::Tab => self.switch_tab(self.tab + 1),
            KeyCode::BackTab => self.switch_tab(self.tab + 4),
            KeyCode::Char('1') => self.switch_tab(0),
            KeyCode::Char('2') => self.switch_tab(1),
            KeyCode::Char('3') => self.switch_tab(2),
            KeyCode::Char('4') => self.switch_tab(3),
            KeyCode::Char('5') => self.switch_tab(4),
            KeyCode::Char('/') => {
                self.focus = InputFocus::Search;
            }
            KeyCode::Char('f') => {
                self.tab = 2;
                self.focus = InputFocus::Search;
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            KeyCode::Char(':') => {
                self.focus = InputFocus::EvalBar;
            }
            KeyCode::Down | KeyCode::Char('j') => self.move_selection(1),
            KeyCode::Up | KeyCode::Char('k') => self.move_selection(-1),
            KeyCode::Right => {
                if self.tab == 0
                    && let Some(row) = self.selected_filtered()
                    && self
                        .entries
                        .get(row.index)
                        .is_some_and(|m| m.kind == "obj" || m.kind == "object")
                {
                    self.activate_selected(false);
                } else {
                    self.switch_tab(self.tab + 1);
                }
            }
            KeyCode::Left => {
                if self.tab == 0 && !self.bh_path.is_empty() {
                    if let Some((parent, _)) = self.bh_path.rsplit_once('.') {
                        self.bh_path = parent.to_string();
                    } else {
                        self.bh_path.clear();
                    }
                    self.reload_bh();
                } else {
                    self.switch_tab(self.tab + 4);
                }
            }
            KeyCode::PageDown | KeyCode::Char(']') => {
                self.inspect_scroll = self.inspect_scroll.saturating_add(4);
            }
            KeyCode::PageUp | KeyCode::Char('[') => {
                self.inspect_scroll = self.inspect_scroll.saturating_sub(4);
            }
            KeyCode::Enter => self.activate_selected(false),
            KeyCode::Char('x' | ' ') => self.activate_selected(true),
            KeyCode::Char('i') => {
                self.show_last_result = !self.show_last_result;
                if !self.show_last_result {
                    self.refresh_inspector_preview();
                }
            }
            KeyCode::Char('t') if self.tab == 4 => {
                self.show_telemetry_in_log = !self.show_telemetry_in_log;
            }
            KeyCode::Backspace => {
                if self.tab == 0 && !self.bh_path.is_empty() {
                    if let Some((parent, _)) = self.bh_path.rsplit_once('.') {
                        self.bh_path = parent.to_string();
                    } else {
                        self.bh_path.clear();
                    }
                    self.reload_bh();
                }
            }
            KeyCode::Char('r') => {
                self.load_all_online();
                self.rebuild_filter();
                self.refresh_inspector_preview();
            }
            _ => {}
        }
        false
    }

    fn draw(&mut self, frame: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Min(6),
                Constraint::Length(1),
            ])
            .split(frame.area());

        self.draw_header(frame, chunks[0]);
        self.draw_search_bar(frame, chunks[1]);

        let body = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
            .split(chunks[2]);

        self.draw_left_pane(frame, body[0]);
        self.draw_inspector(frame, body[1]);
        self.draw_footer(frame, chunks[3]);
        self.draw_modal(frame);
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = BhTuiApp::new();
    run_tui(&mut app, opts, 120)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_snapshot;

    #[test]
    fn fuzzy_search_and_execution_modals_work_end_to_end() {
        let mut app = BhTuiApp::offline();

        // 1. Open Global Fuzzy Palette with 'f' and search "approach"
        app.on_key(KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE));
        for ch in "app".chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
        let s_fuzzy = render_snapshot(&mut app, 100, 28);
        assert!(s_fuzzy.contains("FUZZY COMMAND PALETTE"));
        assert!(s_fuzzy.contains("approach"));

        // 2. Press Enter to open TARS Tool Runner Form, cycle enum with Right, and execute with Enter
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let s_modal = render_snapshot(&mut app, 100, 28);
        assert!(s_modal.contains("RUN TARS TOOL"));
        assert!(s_modal.contains("action"));
        app.on_key(KeyEvent::new(KeyCode::Right, KeyModifiers::NONE));
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(matches!(app.modal, Modal::None));
        assert_eq!(app.history.len(), 1);
        assert!(app.history[0].ok);

        // 3. Switch to __bh API tab, select freeze(on), open Call Modal, pass true, and run
        app.on_key(KeyEvent::new(KeyCode::Char('1'), KeyModifiers::NONE));
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)); // clear search
        app.on_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE)); // freeze
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let s_call = render_snapshot(&mut app, 100, 28);
        assert!(s_call.contains("CALL __bh.freeze"));
        for ch in "true".chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.history.len(), 2);

        // 4. Open Vim-style : Eval command bar and execute a command
        app.on_key(KeyEvent::new(KeyCode::Char(':'), KeyModifiers::NONE));
        for ch in "bh.fleet.active".chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.history.len(), 3);
    }
}
