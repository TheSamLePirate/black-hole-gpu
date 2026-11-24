//! Ratatui F-35B/C WSO Tactical & Radar Console (`obc-f35-tui`).

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Gauge, Paragraph, Row, Table, TableState, Tabs};
use serde_json::{Value, json};

const C_GRN: Color = Color::Rgb(75, 227, 138);
const C_CYN: Color = Color::Rgb(92, 228, 255);
const C_AMB: Color = Color::Rgb(255, 196, 56);
const F35_WPNS: [(&str, &str); 4] = [
    ("AIM-120", "aim120"),
    ("AIM-9X", "aim9x"),
    ("JDAM", "jdam"),
    ("JSM", "jsm"),
];

pub struct F35TuiApp {
    bus: AvionicsBus,
    radar_mode: usize,
    wpn_idx: usize,
    weapon: &'static str,
    tracks: Vec<(String, String, String, String)>,
    track_state: TableState,
    tick_count: u32,
    online: bool,
}

impl F35TuiApp {
    #[must_use]
    pub fn new() -> Self {
        let mut ts = TableState::default();
        ts.select(Some(0));
        let mut app = Self {
            bus: AvionicsBus::new(),
            radar_mode: 1,
            wpn_idx: 0,
            weapon: "AIM-120",
            tracks: Vec::new(),
            track_state: ts,
            tick_count: 0,
            online: true,
        };
        app.refresh_tracks();
        app
    }

    #[must_use]
    pub fn offline() -> Self {
        let mut ts = TableState::default();
        ts.select(Some(0));
        Self {
            bus: AvionicsBus::new(),
            radar_mode: 1,
            wpn_idx: 0,
            weapon: "AIM-120",
            tracks: vec![("AFR63PD".into(), "239°".into(), "8.9 km".into(), "207 m".into())],
            track_state: ts,
            tick_count: 0,
            online: false,
        }
    }

    fn refresh_tracks(&mut self) {
        if !self.online {
            return;
        }
        let Some(v) = self.bus.tars_tool("traffic", &json!({ "action": "list" })) else {
            return;
        };
        let arr = v
            .get("aircraft")
            .or_else(|| v.get("tracks"))
            .and_then(Value::as_array)
            .or_else(|| v.as_array());
        if let Some(list) = arr {
            self.tracks = list
                .iter()
                .take(12)
                .map(|x| {
                    let id = x
                        .get("callsign")
                        .or_else(|| x.get("id"))
                        .and_then(Value::as_str)
                        .unwrap_or("TRK")
                        .to_string();
                    let brg = x
                        .get("bearing_deg")
                        .or_else(|| x.get("bearing"))
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    let km = x
                        .get("distance_km")
                        .or_else(|| x.get("dist_km"))
                        .and_then(Value::as_f64)
                        .or_else(|| x.get("dist_m").and_then(Value::as_f64).map(|m| m * 1e-3))
                        .unwrap_or(0.0);
                    let alt = x
                        .get("altitude_msl_m")
                        .or_else(|| x.get("alt_m"))
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    (id, format!("{brg:03.0}°"), format!("{km:5.1} km"), format!("{alt:5.0} m"))
                })
                .collect();
        }
    }
}

impl Default for F35TuiApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for F35TuiApp {
    fn tick(&mut self) {
        if self.online {
            let _ = self.bus.telemetry();
            self.tick_count = self.tick_count.wrapping_add(1);
            if self.tick_count % 12 == 0 {
                self.refresh_tracks();
            }
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        let modes = ["RWS", "TWS", "STT"];
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Right | KeyCode::Char('r' | 'R') | KeyCode::Tab => {
                self.radar_mode = (self.radar_mode + 1) % 3;
                let _ = self.bus.tars_tool("f35_radar", &json!({ "action": "mode", "mode": modes[self.radar_mode] }));
            }
            KeyCode::Left => {
                self.radar_mode = (self.radar_mode + 2) % 3;
                let _ = self.bus.tars_tool("f35_radar", &json!({ "action": "mode", "mode": modes[self.radar_mode] }));
            }
            KeyCode::Down => {
                if !self.tracks.is_empty() {
                    let i = self.track_state.selected().map_or(0, |s| (s + 1) % self.tracks.len());
                    self.track_state.select(Some(i));
                }
            }
            KeyCode::Up => {
                if !self.tracks.is_empty() {
                    let n = self.tracks.len();
                    let i = self.track_state.selected().map_or(0, |s| if s == 0 { n - 1 } else { s - 1 });
                    self.track_state.select(Some(i));
                }
            }
            KeyCode::Char(' ') => {
                self.wpn_idx = (self.wpn_idx + 1) % F35_WPNS.len();
                let (label, code) = F35_WPNS[self.wpn_idx];
                self.weapon = label;
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": code }));
            }
            KeyCode::Char('1') => {
                self.wpn_idx = 0;
                self.weapon = "AIM-120";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "aim120" }));
            }
            KeyCode::Char('2') => {
                self.wpn_idx = 1;
                self.weapon = "AIM-9X";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "aim9x" }));
            }
            KeyCode::Char('3') => {
                self.wpn_idx = 2;
                self.weapon = "JDAM";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "jdam" }));
            }
            KeyCode::Char('4') => {
                self.wpn_idx = 3;
                self.weapon = "JSM";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "jsm" }));
            }
            KeyCode::Enter | KeyCode::Char('l' | 'L') => {
                let _ = self.bus.tars_tool("f35_radar", &json!({ "action": "lock_next" }));
            }
            KeyCode::Char('c' | 'C') => {
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "countermeasures" }));
            }
            KeyCode::Char('a' | 'A') => {
                let _ = self.bus.set_autopilot("ap");
            }
            _ => {}
        }
        false
    }

    fn draw(&mut self, frame: &mut Frame) {
        let t = self.bus.cached();
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Min(6),
                Constraint::Length(1),
            ])
            .split(frame.area());

        let tabs = Tabs::new(vec![" AN/APG-81 RWS ", " AN/APG-81 TWS ", " AN/APG-81 STT "])
            .select(self.radar_mode)
            .block(
                Block::default()
                    .title(format!(
                        " OBC-F35-TUI · F-35B/C TACTICAL WSO [RUST/RATATUI] · WPN:{} ",
                        self.weapon
                    ))
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(C_GRN)),
            )
            .highlight_style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD));
        frame.render_widget(tabs, rows[0]);

        let g_cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[1]);
        let fuel = (t.systems.fuel_frac * 100.0).clamp(0.0, 100.0) as u16;
        let thr = (t.systems.throttle * 100.0).clamp(0.0, 100.0) as u16;
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" INTERNAL FUEL ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_GRN))
                .percent(fuel),
            g_cols[0],
        );
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" F135 THROTTLE ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_AMB))
                .percent(thr),
            g_cols[1],
        );

        let body = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(42), Constraint::Percentage(58)])
            .split(rows[2]);

        let u = t.unit_sys();
        let status = Table::new(
            vec![
                Row::new(["HDG / ALT".to_string(), format!("{:03.0}° / {}", t.heading_wrapped(), u.f_alt(t.position.altitude_msl_m))]),
                Row::new(["TAS / MACH".to_string(), format!("{} / M{:.2}", u.f_spd(t.flight.true_airspeed_mps), t.flight.mach)]),
                Row::new(["G-LOAD / AOA".to_string(), format!("{:+.2} G / {:.1}°", t.flight.g_load, t.flight.alpha_deg)]),
                Row::new(["AUTOPILOT".to_string(), format!("{} (GEAR {})", t.systems.autopilot, if t.systems.gear > 0.5 { "DN" } else { "UP" })]),
                Row::new(["SELECTED WPN".to_string(), self.weapon.to_string()]),
            ],
            [Constraint::Length(14), Constraint::Min(14)],
        )
        .block(
            Block::default()
                .title(" AIRCRAFT & STORES ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_GRN)),
        );
        frame.render_widget(status, body[0]);

        let trk_rows: Vec<Row> = self
            .tracks
            .iter()
            .map(|(id, b, d, a)| Row::new([id.as_str(), b.as_str(), d.as_str(), a.as_str()]))
            .collect();
        let trk_tbl = Table::new(
            trk_rows,
            [
                Constraint::Length(10),
                Constraint::Length(7),
                Constraint::Length(10),
                Constraint::Min(8),
            ],
        )
        .header(
            Row::new(["CALLSIGN", "BRG", "RANGE", "ALT"])
                .style(Style::default().fg(C_CYN).add_modifier(Modifier::BOLD)),
        )
        .block(
            Block::default()
                .title(format!(" TACTICAL PICTURE ({} TRACKS) ", self.tracks.len()))
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        )
        .row_highlight_style(Style::default().bg(Color::Rgb(16, 54, 72)).fg(C_AMB).add_modifier(Modifier::BOLD));
        frame.render_stateful_widget(trk_tbl, body[1], &mut self.track_state);

        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" [←→] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Radar "),
                Span::styled("[↑↓] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Track "),
                Span::styled("[Enter] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Lock "),
                Span::styled("[Space/1-4] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Wpn "),
                Span::styled("[q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Quit"),
            ])),
            rows[3],
        );
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = F35TuiApp::new();
    run_tui(&mut app, opts, 120)
}
