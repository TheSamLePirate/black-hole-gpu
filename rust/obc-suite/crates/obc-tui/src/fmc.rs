//! Ratatui Flight Management Computer (`obc-fmc-tui`) — WGS84 airports, ETA & ILS deviation bars.

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::{AvionicsBus, WORLD_AIRPORTS, wgs84_bearing_dist};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Gauge, Paragraph, Row, Table, TableState};

const C_CYN: Color = Color::Rgb(98, 230, 255);
const C_GRN: Color = Color::Rgb(110, 248, 148);
const C_MAG: Color = Color::Rgb(246, 98, 232);
const C_AMB: Color = Color::Rgb(255, 196, 56);

pub struct FmcApp {
    bus: AvionicsBus,
    state: TableState,
    online: bool,
}

impl FmcApp {
    #[must_use]
    pub fn new() -> Self {
        let mut st = TableState::default();
        st.select(Some(0));
        Self {
            bus: AvionicsBus::new(),
            state: st,
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

impl Default for FmcApp {
    fn default() -> Self {
        Self::new()
    }
}

impl TuiApp for FmcApp {
    fn tick(&mut self) {
        if self.online {
            let _ = self.bus.telemetry();
        }
    }

    fn on_key(&mut self, key: KeyEvent) -> bool {
        let n = WORLD_AIRPORTS.len();
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Down | KeyCode::Char('j') => {
                let i = self.state.selected().map_or(0, |s| (s + 1) % n);
                self.state.select(Some(i));
            }
            KeyCode::Up | KeyCode::Char('k') => {
                let i = self.state.selected().map_or(0, |s| if s == 0 { n - 1 } else { s - 1 });
                self.state.select(Some(i));
            }
            KeyCode::Char('i' | 'I') => {
                let _ = self.bus.set_autopilot("ils");
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

        let rwy = t.nav.runway.as_ref();
        let loc_pct = rwy.map_or(50, |r| (((r.loc_deg / 2.5) * 0.5 + 0.5).clamp(0.0, 1.0) * 100.0) as u16);
        let gs_pct = rwy.map_or(50, |r| (((r.gs_deg / 0.7) * 0.5 + 0.5).clamp(0.0, 1.0) * 100.0) as u16);

        let top_cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[0]);
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" ILS LOCALIZER ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_MAG))
                .percent(loc_pct)
                .label(rwy.map_or_else(|| "NO ILS".into(), |r| format!("{} {:+.2}°", r.ident, r.loc_deg))),
            top_cols[0],
        );
        frame.render_widget(
            Gauge::default()
                .block(Block::default().title(" ILS GLIDESLOPE ").borders(Borders::ALL))
                .gauge_style(Style::default().fg(C_CYN))
                .percent(gs_pct)
                .label(rwy.map_or_else(|| "STANDBY".into(), |r| format!("DME {:.1} NM · {:+.2}°", r.dist_m * 0.000_539_957, r.gs_deg))),
            top_cols[1],
        );

        let mut list: Vec<_> = WORLD_AIRPORTS
            .iter()
            .map(|a| {
                let (brg, km) = wgs84_bearing_dist(t.position.lat_deg, t.position.lon_deg, a.lat_deg, a.lon_deg);
                (a, brg, km)
            })
            .collect();
        list.sort_by(|a, b| a.2.total_cmp(&b.2));

        let gs = t.flight.ground_speed_mps.max(1.0);
        let tbl_rows: Vec<Row> = list
            .iter()
            .map(|(a, brg, km)| {
                let eta_min = (km * 1000.0) / gs / 60.0;
                Row::new([
                    a.icao.to_string(),
                    a.name.to_string(),
                    format!("{brg:05.1}°"),
                    format!("{km:7.1} km"),
                    format!("{:5.1} NM", km * 0.539_957),
                    if eta_min < 999.0 { format!("{eta_min:5.1} m") } else { "---".into() },
                ])
            })
            .collect();

        let tbl = Table::new(
            tbl_rows,
            [
                Constraint::Length(6),
                Constraint::Min(18),
                Constraint::Length(8),
                Constraint::Length(11),
                Constraint::Length(9),
                Constraint::Length(8),
            ],
        )
        .header(
            Row::new(["ICAO", "AIRPORT", "BRG", "DIST KM", "DIST NM", "ETA"])
                .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
        )
        .block(
            Block::default()
                .title(format!(
                    " OBC-FMC-TUI · WGS84 NAVIGATION ({:.3}°, {:.3}°) ",
                    t.position.lat_deg, t.position.lon_deg
                ))
                .borders(Borders::ALL)
                .border_type(BorderType::Rounded)
                .border_style(Style::default().fg(C_CYN)),
        )
        .row_highlight_style(Style::default().bg(Color::Rgb(16, 54, 72)).fg(C_GRN));
        frame.render_stateful_widget(tbl, rows[1], &mut self.state);

        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(" [↑/↓] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Select Airport  "),
                Span::styled(" [i] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Engage ILS  "),
                Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                Span::raw("Quit"),
            ])),
            rows[2],
        );
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = FmcApp::new();
    run_tui(&mut app, opts, 150)
}
