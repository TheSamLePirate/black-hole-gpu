//! Real-time Ratatui Avionics System Monitor (`obc-top`) with Sparklines & Gauges.

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Gauge, Paragraph, Row, Sparkline, Table};
use std::collections::VecDeque;

const C_CYN: Color = Color::Rgb(98, 230, 255);
const C_GRN: Color = Color::Rgb(110, 248, 148);
const C_AMB: Color = Color::Rgb(255, 196, 56);

const TOP_CMDS: [&str; 5] = ["SAS", "GEAR", "PROGRADE", "RETRO", "HOLD OFF"];

pub struct TopApp {
    bus: AvionicsBus,
    spd_hist: VecDeque<u64>,
    g_hist: VecDeque<u64>,
    cmd_idx: usize,
    online: bool,
}

impl TopApp {
    #[must_use]
    pub fn new() -> Self {
        Self {
            bus: AvionicsBus::new(),
            spd_hist: VecDeque::from(vec![0; 64]),
            g_hist: VecDeque::from(vec![10; 64]),
            cmd_idx: 0,
            online: true,
        }
    }

    #[must_use]
    pub fn offline() -> Self {
        Self {
            online: false,
            ..Self::new()
        }
    }
}

impl Default for TopApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for TopApp {
    fn tick(&mut self) {
        if self.online {
            let t = self.bus.telemetry().clone();
            if self.spd_hist.len() >= 64 {
                self.spd_hist.pop_front();
            }
            self.spd_hist.push_back(t.flight.true_airspeed_mps.max(0.0) as u64);
            if self.g_hist.len() >= 64 {
                self.g_hist.pop_front();
            }
            self.g_hist
                .push_back(((t.flight.g_load + 2.0) * 10.0).clamp(0.0, 120.0) as u64);
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        let t = self.bus.cached().clone();
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Up | KeyCode::Char('+' | ']' | '=') => {
                let _ = self.bus.set_throttle(t.systems.throttle + 0.1);
            }
            KeyCode::Down | KeyCode::Char('-' | '[' | '_') => {
                let _ = self.bus.set_throttle(t.systems.throttle - 0.1);
            }
            KeyCode::Right => {
                self.cmd_idx = (self.cmd_idx + 1) % TOP_CMDS.len();
            }
            KeyCode::Left => {
                self.cmd_idx = if self.cmd_idx == 0 {
                    TOP_CMDS.len() - 1
                } else {
                    self.cmd_idx - 1
                };
            }
            KeyCode::Enter | KeyCode::Char(' ') => match self.cmd_idx {
                0 => {
                    let _ = self.bus.set_sas(!t.systems.sas);
                }
                1 => {
                    let _ = self.bus.set_gear(t.systems.gear < 0.5);
                }
                2 => {
                    let _ = self.bus.set_hold("prograde");
                }
                3 => {
                    let _ = self.bus.set_hold("retrograde");
                }
                _ => {
                    let _ = self.bus.set_hold("none");
                }
            },
            KeyCode::Char('s' | 'S') => {
                let _ = self.bus.set_sas(!t.systems.sas);
            }
            KeyCode::Char('g' | 'G') => {
                let _ = self.bus.set_gear(t.systems.gear < 0.5);
            }
            KeyCode::Char('p' | 'P') => {
                let _ = self.bus.set_hold("prograde");
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
                Constraint::Length(4),
                Constraint::Length(1),
            ])
            .split(frame.area());

        let hdr = Paragraph::new(format!(
            " VESSEL: {} ({})   BODY: {}   WARP: {:.1}x   dτ/dt: {:.9}",
            t.vessel_id.to_uppercase(),
            t.vessel_kind,
            t.body.to_uppercase(),
            t.warp,
            t.dtau_dt
        ))
        .block(
            Block::default()
                .title(" OBC-TOP · RUST/RATATUI AVIONICS MONITOR ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        );
        frame.render_widget(hdr, rows[0]);

        // Gauges row: Throttle & Fuel
        let g_cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[1]);
        let thr_pct = (t.systems.throttle * 100.0).clamp(0.0, 100.0) as u16;
        let fuel_pct = (t.systems.fuel_frac * 100.0).clamp(0.0, 100.0) as u16;
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" THROTTLE ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_AMB))
                .percent(thr_pct)
                .label(format!("{thr_pct}%")),
            g_cols[0],
        );
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" FUEL ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_GRN))
                .percent(fuel_pct)
                .label(format!("{fuel_pct}%")),
            g_cols[1],
        );

        // Telemetry table
        let tbl = Table::new(
            vec![
                Row::new([
                    "WGS84 POSITION".into(),
                    format!("LAT {:+.4}°  LON {:+.4}°", t.position.lat_deg, t.position.lon_deg),
                    format!("MSL {}  AGL {}", t.unit_sys().f_alt(t.position.altitude_msl_m), t.unit_sys().f_alt(t.position.height_over_ground_m)),
                ]),
                Row::new([
                    "ATTITUDE".into(),
                    format!("HDG {:05.1}°  PITCH {:+5.1}°", t.heading_wrapped(), t.attitude.pitch_deg),
                    format!("ROLL {:+5.1}°  G {:+.2}", t.attitude.roll_deg, t.flight.g_load),
                ]),
                Row::new([
                    "FLIGHT".into(),
                    format!("TAS {}", t.unit_sys().f_spd(t.flight.true_airspeed_mps)),
                    format!("MACH {:.2}  VS {}", t.flight.mach, t.unit_sys().f_vs(t.flight.vertical_speed_mps)),
                ]),
                Row::new([
                    "SYSTEMS".into(),
                    format!("AP:{}  HOLD:{}  SAS:{}", t.systems.autopilot, t.systems.hold, if t.systems.sas { "ON" } else { "OFF" }),
                    format!("GEAR:{}  FLAPS:{:.0}%", if t.systems.gear > 0.5 { "DOWN" } else { "UP" }, t.systems.flaps * 100.0),
                ]),
            ],
            [Constraint::Length(16), Constraint::Percentage(42), Constraint::Min(20)],
        )
        .block(
            Block::default()
                .title(" LIVE TELEMETRY ")
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        );
        frame.render_widget(tbl, rows[2]);

        // Sparklines
        let sp_cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[3]);
        let spd_slice: Vec<u64> = self.spd_hist.iter().copied().collect();
        let g_slice: Vec<u64> = self.g_hist.iter().copied().collect();
        frame.render_widget(
            Sparkline::default()
                .block(Block::default().title(" TAS HISTORY (m/s) ").borders(Borders::ALL))
                .data(&spd_slice)
                .style(Style::default().fg(C_CYN)),
            sp_cols[0],
        );
        frame.render_widget(
            Sparkline::default()
                .block(Block::default().title(" G-LOAD HISTORY ").borders(Borders::ALL))
                .data(&g_slice)
                .style(Style::default().fg(C_GRN)),
            sp_cols[1],
        );

        let mut f_spans = vec![
            Span::styled(" [↑↓] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Thr "),
            Span::styled("[←→+Ent] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
        ];
        for (i, label) in TOP_CMDS.iter().enumerate() {
            if i == self.cmd_idx {
                f_spans.push(Span::styled(
                    format!("▸{label} "),
                    Style::default().fg(C_GRN).add_modifier(Modifier::BOLD),
                ));
            } else {
                f_spans.push(Span::styled(format!("{label} "), Style::default().fg(C_CYN)));
            }
        }
        f_spans.push(Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)));
        f_spans.push(Span::raw("Quit"));
        frame.render_widget(Paragraph::new(Line::from(f_spans)), rows[4]);
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = TopApp::new();
    run_tui(&mut app, opts, 100)
}
