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

pub struct A320TuiApp {
    bus: AvionicsBus,
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
            KeyCode::Char('o' | 'O') => {
                let _ = self.bus.mcdu("page", Some("obc"));
                self.refresh_mcdu();
            }
            KeyCode::Char('f' | 'F') => {
                let _ = self.bus.mcdu("page", Some("fpln"));
                self.refresh_mcdu();
            }
            KeyCode::Char('p' | 'P') => {
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
                Constraint::Min(12),
                Constraint::Length(2),
            ])
            .split(frame.area());

        let fcu = Paragraph::new(format!(
            " FCU: SPD {:3.0} kt · HDG {:03.0}° · ALT {:5.0} ft · V/S {:+5.0} fpm · AP:{} · FLAPS {:2.0}% · GEAR {}",
            t.tas_knots(),
            t.heading_wrapped(),
            t.alt_msl_feet(),
            t.vs_fpm(),
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
            .map_or_else(|| "NONE".into(), |r| format!("{} ({:.1} NM)", r.ident, r.dist_m * 0.000_539_957));
        let ecam = Table::new(
            vec![
                Row::new(["THRUST".to_string(), format!("{:.0}%", t.systems.throttle * 100.0)]),
                Row::new(["FOB / FUEL".to_string(), format!("{:.0}%", t.systems.fuel_frac * 100.0)]),
                Row::new(["PITCH / ROLL".to_string(), format!("{:+.1}° / {:+.1}°", t.attitude.pitch_deg, t.attitude.roll_deg)]),
                Row::new(["MACH / G".to_string(), format!("M{:.2} / {:+.2} G", t.flight.mach, t.flight.g_load)]),
                Row::new(["ILS APPROACH".to_string(), rwy]),
                Row::new(["AGL".to_string(), format!("{:.0} m", t.position.height_over_ground_m)]),
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
                Span::styled(" [o] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("MCDU OBC  "),
                Span::styled(" [f] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("F-PLN  "),
                Span::styled(" [p] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("PERF  "),
                Span::styled(" [a] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("AP1  "),
                Span::styled(" [g] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Gear  "),
                Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
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
