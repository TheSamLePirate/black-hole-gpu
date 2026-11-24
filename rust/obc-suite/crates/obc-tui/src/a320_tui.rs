//! Ratatui Airbus A320 FCU + Live Captain MCDU & Lower ECAM Console (`obc-a320-tui`).

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Row, Table, Wrap};
use serde_json::Value;
use std::fmt::Write as _;

const C_CYN: Color = Color::Rgb(62, 200, 255);
const C_GRN: Color = Color::Rgb(96, 246, 146);
const C_AMB: Color = Color::Rgb(255, 196, 56);

const A320_PAGES: [&str; 6] = ["obc", "menu", "fpln", "perf", "radnav", "prog"];

pub struct A320TuiApp {
    bus: AvionicsBus,
    page_idx: usize,
    lsk_idx: u8,
    mcdu_title: String,
    mcdu_lines: Vec<String>,
    scratchpad: String,
    tick_count: u32,
    online: bool,
}

impl A320TuiApp {
    #[must_use]
    pub fn new() -> Self {
        let mut app = Self {
            bus: AvionicsBus::new(),
            page_idx: 0,
            lsk_idx: 1,
            mcdu_title: "OBC LINUX LINK".into(),
            mcdu_lines: vec!["<OBC STATUS          READY>".into()],
            scratchpad: String::new(),
            tick_count: 0,
            online: true,
        };
        app.refresh_mcdu();
        app
    }

    #[must_use]
    pub fn offline() -> Self {
        Self {
            bus: AvionicsBus::new(),
            page_idx: 0,
            lsk_idx: 1,
            mcdu_title: "OBC LINUX LINK".into(),
            mcdu_lines: vec![
                "<OBC KERNEL    LINUX 7.3>".into(),
                "<TELEMETRY     MOUNTED>".into(),
            ],
            scratchpad: "LFPB".into(),
            tick_count: 0,
            online: false,
        }
    }

    fn refresh_mcdu(&mut self) {
        if !self.online {
            return;
        }
        if let Some(v) = self.bus.mcdu("screen", None) {
            if let Some(t) = v.get("title").and_then(Value::as_str)
                && !t.is_empty()
            {
                self.mcdu_title = t.to_string();
            }
            if let Some(sp) = v.get("scratchpad").and_then(Value::as_str) {
                self.scratchpad = sp.to_string();
            }
            if let Some(rows) = v.get("rows").and_then(Value::as_array) {
                self.mcdu_lines = rows
                    .iter()
                    .map(|r| {
                        if let Some(s) = r.as_str() {
                            s.to_string()
                        } else {
                            let l = r.get("left").and_then(Value::as_str).unwrap_or("");
                            let ri = r.get("right").and_then(Value::as_str).unwrap_or("");
                            format!("{l:<16} {ri:>14}")
                        }
                    })
                    .collect();
            }
        }
    }
}

impl Default for A320TuiApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for A320TuiApp {
    fn tick(&mut self) {
        if self.online {
            let _ = self.bus.telemetry();
            self.tick_count = self.tick_count.wrapping_add(1);
            if self.tick_count % 8 == 0 {
                self.refresh_mcdu();
            }
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        let t = self.bus.cached().clone();
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Right => {
                self.page_idx = (self.page_idx + 1) % A320_PAGES.len();
                let _ = self.bus.mcdu("page", Some(A320_PAGES[self.page_idx]));
                self.refresh_mcdu();
            }
            KeyCode::Left => {
                self.page_idx = if self.page_idx == 0 {
                    A320_PAGES.len() - 1
                } else {
                    self.page_idx - 1
                };
                let _ = self.bus.mcdu("page", Some(A320_PAGES[self.page_idx]));
                self.refresh_mcdu();
            }
            KeyCode::Down => {
                self.lsk_idx = if self.lsk_idx >= 6 { 1 } else { self.lsk_idx + 1 };
            }
            KeyCode::Up => {
                self.lsk_idx = if self.lsk_idx <= 1 { 6 } else { self.lsk_idx - 1 };
            }
            KeyCode::Enter => {
                let _ = self.bus.rpc(
                    serde_json::json!({ "op": "mcdu", "action": "lsk", "lskSide": "L", "lskNum": self.lsk_idx }),
                    1500,
                );
                self.refresh_mcdu();
            }
            KeyCode::Char('o' | 'O') => {
                self.page_idx = 0;
                let _ = self.bus.mcdu("page", Some("obc"));
                self.refresh_mcdu();
            }
            KeyCode::Char('f' | 'F') => {
                self.page_idx = 2;
                let _ = self.bus.mcdu("page", Some("fpln"));
                self.refresh_mcdu();
            }
            KeyCode::Char('p' | 'P') => {
                self.page_idx = 3;
                let _ = self.bus.mcdu("page", Some("perf"));
                self.refresh_mcdu();
            }
            KeyCode::Char('a' | 'A') => {
                let _ = self.bus.set_autopilot("ap");
            }
            KeyCode::Char('g' | 'G') => {
                let _ = self.bus.set_gear(t.systems.gear < 0.5);
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
                Constraint::Min(6),
                Constraint::Length(1),
            ])
            .split(frame.area());

        let u = t.unit_sys();
        let fcu = Paragraph::new(format!(
            " FCU: SPD {} · HDG {:03.0}° · ALT {} · V/S {} · AP:{} · FLAPS {:2.0}% · GEAR {}",
            u.f_spd(t.flight.true_airspeed_mps),
            t.heading_wrapped(),
            u.f_alt(t.position.altitude_msl_m),
            u.f_vs(t.flight.vertical_speed_mps),
            if t.systems.autopilot.is_empty() { "OFF" } else { &t.systems.autopilot },
            t.systems.flaps * 100.0,
            if t.systems.gear > 0.5 { "DOWN" } else { "UP" }
        ))
        .block(
            Block::default()
                .title(" OBC-A320-TUI · AIRBUS A320 FCU + CAPTAIN MCDU [RUST/RATATUI] ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        );
        frame.render_widget(fcu, rows[0]);

        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(54), Constraint::Percentage(46)])
            .split(rows[1]);

        let mut mcdu_body = format!("  {}\n{}\n", self.mcdu_title, "─".repeat(34));
        for line in &self.mcdu_lines {
            mcdu_body.push_str(line);
            mcdu_body.push('\n');
        }
        let _ = write!(mcdu_body, "\nSCRATCHPAD: {}", self.scratchpad);
        let mcdu_widget = Paragraph::new(mcdu_body)
            .style(Style::default().fg(C_GRN))
            .wrap(Wrap { trim: false })
            .block(
                Block::default()
                    .title(" CAPTAIN MCDU LIVE MIRROR ")
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(C_GRN)),
            );
        frame.render_widget(mcdu_widget, cols[0]);

        let rwy = t
            .nav
            .runway
            .as_ref()
            .map_or_else(|| "NONE".into(), |r| format!("{} ({})", r.ident, u.f_dist(r.dist_m, 1)));
        let ecam = Table::new(
            vec![
                Row::new(["THRUST".to_string(), format!("{:.0}%", t.systems.throttle * 100.0)]),
                Row::new(["FOB / FUEL".to_string(), format!("{:.0}%", t.systems.fuel_frac * 100.0)]),
                Row::new(["PITCH / ROLL".to_string(), format!("{:+.1}° / {:+.1}°", t.attitude.pitch_deg, t.attitude.roll_deg)]),
                Row::new(["MACH / G".to_string(), format!("M{:.2} / {:+.2} G", t.flight.mach, t.flight.g_load)]),
                Row::new(["ILS APPROACH".to_string(), rwy]),
                Row::new(["AGL".to_string(), u.f_alt(t.position.height_over_ground_m)]),
            ],
            [Constraint::Length(14), Constraint::Min(14)],
        )
        .block(
            Block::default()
                .title(" ECAM / FLIGHT STATUS ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        );
        frame.render_widget(ecam, cols[1]);

        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" [←→] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw(format!("Page({}) ", A320_PAGES[self.page_idx].to_uppercase())),
                Span::styled("[↑↓+Ent] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw(format!("LSK L{} ", self.lsk_idx)),
                Span::styled("[a] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("AP1 "),
                Span::styled("[g] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Gear "),
                Span::styled("[q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Quit"),
            ])),
            rows[2],
        );
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = A320TuiApp::new();
    run_tui(&mut app, opts, 120)
}
