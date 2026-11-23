//! Ratatui F-35B/C WSO Tactical & Radar Console (`obc-f35-tui`).

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Gauge, Paragraph, Row, Table, Tabs};
use serde_json::{Value, json};

const C_GRN: Color = Color::Rgb(75, 227, 138);
const C_CYN: Color = Color::Rgb(92, 228, 255);
const C_AMB: Color = Color::Rgb(255, 196, 56);

pub struct F35TuiApp {
    bus: AvionicsBus,
    radar_mode: usize,
    weapon: &'static str,
    tracks: Vec<(String, String, String, String)>,
    tick_count: u32,
    online: bool,
}

impl F35TuiApp {
    #[must_use]
    pub fn new() -> Self {
        let mut app = Self {
            bus: AvionicsBus::new(),
            radar_mode: 1,
            weapon: "AIM-120",
            tracks: Vec::new(),
            tick_count: 0,
            online: true,
        };
        app.refresh_tracks();
        app
    }

    #[must_use]
    pub fn offline() -> Self {
        Self {
            bus: AvionicsBus::new(),
            radar_mode: 1,
            weapon: "AIM-120",
            tracks: vec![("AFR63PD".into(), "239°".into(), "8.9 km".into(), "207 m".into())],
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
            KeyCode::Char('r' | 'R') | KeyCode::Tab => {
                self.radar_mode = (self.radar_mode + 1) % 3;
                let _ = self.bus.tars_tool("f35_radar", &json!({ "action": "mode", "mode": modes[self.radar_mode] }));
            }
            KeyCode::Char('1') => {
                self.weapon = "AIM-120";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "aim120" }));
            }
            KeyCode::Char('2') => {
                self.weapon = "AIM-9X";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "aim9x" }));
            }
            KeyCode::Char('3') => {
                self.weapon = "JDAM";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "jdam" }));
            }
            KeyCode::Char('4') => {
                self.weapon = "JSM";
                let _ = self.bus.tars_tool("f35_weapons", &json!({ "action": "select", "weapon": "jsm" }));
            }
            KeyCode::Char('l' | 'L') => {
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

        let status = Table::new(
            vec![
                Row::new(["HDG / ALT".to_string(), format!("{:03.0}° / {:.0} ft", t.heading_wrapped(), t.alt_msl_feet())]),
                Row::new(["TAS / MACH".to_string(), format!("{:.0} kt / M{:.2}", t.tas_knots(), t.flight.mach)]),
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
        );
        frame.render_widget(trk_tbl, body[1]);

        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" [1-4] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Weapon  "),
                Span::styled(" [r] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("RWS/TWS/STT  "),
                Span::styled(" [l] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Lock  "),
                Span::styled(" [c] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("CM  "),
                Span::styled(" [a] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("AP  "),
                Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
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
