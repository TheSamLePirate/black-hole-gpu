//! Ratatui Orbital Flight Director (`obc-mission-tui`) with Braille Canvas orbital plot.

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::symbols::Marker;
use ratatui::text::{Line, Span};
use ratatui::widgets::canvas::{Canvas, Circle};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Row, Table};

const C_CYN: Color = Color::Rgb(98, 230, 255);
const C_GRN: Color = Color::Rgb(110, 248, 148);
const C_AMB: Color = Color::Rgb(255, 196, 56);

pub struct MissionApp {
    bus: AvionicsBus,
    online: bool,
}

impl MissionApp {
    #[must_use]
    pub fn new() -> Self {
        Self {
            bus: AvionicsBus::new(),
            online: true,
        }
    }

    #[must_use]
    pub fn offline() -> Self {
        Self {
            bus: AvionicsBus::new(),
            online: false,
        }
    }
}

impl Default for MissionApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for MissionApp {
    fn tick(&mut self) {
        if self.online {
            let _ = self.bus.telemetry();
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Char('c' | 'C') => {
                let _ = self.bus.set_autopilot("circularize");
            }
            KeyCode::Char('p' | 'P') => {
                let _ = self.bus.set_hold("prograde");
            }
            KeyCode::Char('r' | 'R') => {
                let _ = self.bus.set_hold("retrograde");
            }
            _ => {}
        }
        false
    }

    fn draw(&mut self, frame: &mut Frame) {
        let t = self.bus.cached();
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(8), Constraint::Length(1)])
            .split(frame.area());
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(52), Constraint::Percentage(48)])
            .split(rows[0]);

        let ecc = t.orbit.as_ref().map_or(0.02, |o| o.eccentricity.clamp(0.0, 0.85));
        let ap_km = t.orbit.as_ref().map_or(400.0, |o| o.apoapsis_m * 1e-3);
        let pe_km = t.orbit.as_ref().map_or(400.0, |o| o.periapsis_m * 1e-3);
        let inc = t.orbit.as_ref().map_or(0.0, |o| o.inclination_deg);
        let period_min = t.orbit.as_ref().map_or(92.0, |o| o.period_s / 60.0);

        let canvas = Canvas::default()
            .block(
                Block::default()
                    .title(" OBC-MISSION-TUI · ORBITAL PLOT ")
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(C_CYN)),
            )
            .marker(Marker::Braille)
            .x_bounds([-100.0, 100.0])
            .y_bounds([-100.0, 100.0])
            .paint(move |ctx| {
                ctx.draw(&Circle {
                    x: 0.0,
                    y: 0.0,
                    radius: 28.0,
                    color: C_CYN,
                });
                ctx.draw(&Circle {
                    x: -ecc * 35.0,
                    y: 0.0,
                    radius: 68.0,
                    color: C_GRN,
                });
                ctx.print(58.0, 4.0, "PE");
                ctx.print(-76.0, 4.0, "AP");
            });
        frame.render_widget(canvas, cols[0]);

        let tbl = Table::new(
            vec![
                Row::new(["VESSEL".to_string(), t.vessel_id.clone()]),
                Row::new(["PRIMARY".to_string(), t.body.clone()]),
                Row::new(["APOAPSIS".to_string(), format!("{ap_km:.1} km")]),
                Row::new(["PERIAPSIS".to_string(), format!("{pe_km:.1} km")]),
                Row::new(["ECCENTRICITY".to_string(), format!("{ecc:.4}")]),
                Row::new(["INCLINATION".to_string(), format!("{inc:.2}°")]),
                Row::new(["PERIOD".to_string(), format!("{period_min:.1} min")]),
                Row::new(["SPEED".to_string(), format!("{:.1} m/s", t.flight.true_airspeed_mps)]),
                Row::new(["RELATIVITY dτ/dt".to_string(), format!("{:.9}", t.dtau_dt)]),
                Row::new(["AUTOPILOT / HOLD".to_string(), format!("{} / {}", t.systems.autopilot, t.systems.hold)]),
            ],
            [Constraint::Length(18), Constraint::Min(14)],
        )
        .block(
            Block::default()
                .title(" KEPLERIAN ELEMENTS ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_GRN)),
        );
        frame.render_widget(tbl, cols[1]);

        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" [c] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Circularize  "),
                Span::styled(" [p] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Prograde  "),
                Span::styled(" [r] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Retrograde  "),
                Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Quit"),
            ])),
            rows[1],
        );
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = MissionApp::new();
    run_tui(&mut app, opts, 120)
}
