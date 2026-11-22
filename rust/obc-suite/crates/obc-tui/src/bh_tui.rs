//! Universal `__bh` API & 73 TARS Tools Interactive Ratatui Explorer (`bh-tui`).

use crate::{TuiApp, TuiRunOpts, run_tui};
use anyhow::Result;
use crossterm::event::{KeyCode, KeyEvent};
use obc_core::AvionicsBus;
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Cell, Paragraph, Row, Table, TableState, Tabs, Wrap};

const C_CYN: Color = Color::Rgb(98, 230, 255);
const C_GRN: Color = Color::Rgb(110, 248, 148);
const C_AMB: Color = Color::Rgb(255, 196, 56);
const C_DIM: Color = Color::Rgb(118, 158, 178);

pub struct BhTuiApp {
    bus: AvionicsBus,
    tab: usize, // 0 = __bh Tree, 1 = TARS TOOLS, 2 = Live Telemetry
    bh_path: String,
    entries: Vec<(String, String, String)>,
    tools: Vec<(String, String, Vec<String>)>,
    table_state: TableState,
    inspect: String,
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
            tools: Vec::new(),
            table_state: TableState::default(),
            inspect: "Select an item and press Enter to inspect or drill down.".into(),
            online: true,
        };
        app.reload_bh();
        app.tools = app.bus.tars_tools();
        if !app.entries.is_empty() {
            app.table_state.select(Some(0));
        }
        app
    }

    #[must_use]
    pub fn offline() -> Self {
        let mut ts = TableState::default();
        ts.select(Some(0));
        Self {
            bus: AvionicsBus::new(),
            tab: 0,
            bh_path: String::new(),
            entries: vec![
                ("fleet".into(), "object".into(), "{ active: \"ranger\" }".into()),
                ("tars".into(), "object".into(), "73 tools".into()),
                ("camera".into(), "object".into(), "attitudeNow, pilot".into()),
            ],
            tools: vec![
                ("approach".into(), "List/select real ILS approaches".into(), vec!["action".into(), "field".into()]),
                ("obc".into(), "Control embedded Linux OBC".into(), vec!["action".into()]),
            ],
            table_state: ts,
            inspect: "Offline preview mode".into(),
            online: false,
        }
    }

    fn reload_bh(&mut self) {
        if !self.online {
            return;
        }
        self.entries = self.bus.bh_ls(&self.bh_path);
        if self.entries.is_empty() {
            self.table_state.select(None);
        } else {
            self.table_state.select(Some(0));
        }
    }

    fn current_len(&self) -> usize {
        match self.tab {
            0 => self.entries.len(),
            1 => self.tools.len(),
            _ => 0,
        }
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
        match key.code {
            KeyCode::Char('q' | 'Q') | KeyCode::Esc => return true,
            KeyCode::Tab => {
                self.tab = (self.tab + 1) % 3;
                if self.tab == 1 && self.tools.is_empty() && self.online {
                    self.tools = self.bus.tars_tools();
                }
                let len = self.current_len();
                self.table_state.select(if len > 0 { Some(0) } else { None });
            }
            KeyCode::BackTab => {
                self.tab = (self.tab + 2) % 3;
                let len = self.current_len();
                self.table_state.select(if len > 0 { Some(0) } else { None });
            }
            KeyCode::Down | KeyCode::Char('j') => {
                let len = self.current_len();
                if len > 0 {
                    let i = self.table_state.selected().map_or(0, |s| (s + 1) % len);
                    self.table_state.select(Some(i));
                }
            }
            KeyCode::Up | KeyCode::Char('k') => {
                let len = self.current_len();
                if len > 0 {
                    let i = self
                        .table_state
                        .selected()
                        .map_or(0, |s| if s == 0 { len - 1 } else { s - 1 });
                    self.table_state.select(Some(i));
                }
            }
            KeyCode::Enter => {
                if self.tab == 0
                    && let Some(idx) = self.table_state.selected()
                    && let Some((name, kind, _)) = self.entries.get(idx).cloned()
                {
                    let next = if self.bh_path.is_empty() {
                        name
                    } else {
                        format!("{}.{name}", self.bh_path)
                    };
                    if kind == "object" {
                        self.bh_path = next;
                        self.reload_bh();
                        self.inspect = format!("Entered __bh.{}", self.bh_path);
                    } else if self.online {
                        let val = self.bus.bh_get(&next);
                        self.inspect = val.map_or_else(
                            || format!("__bh.{next} ({kind})"),
                            |v| serde_json::to_string_pretty(&v).unwrap_or_default(),
                        );
                    }
                } else if self.tab == 1
                    && let Some(idx) = self.table_state.selected()
                    && let Some((name, desc, params)) = self.tools.get(idx)
                {
                    self.inspect = format!(
                        "TARS Tool: {name}\nParams: {}\n\n{desc}\n\nCLI: bh tool {name} '{{...}}'",
                        params.join(", ")
                    );
                }
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
                if self.tab == 0 {
                    self.reload_bh();
                } else if self.tab == 1 && self.online {
                    self.tools = self.bus.tars_tools();
                }
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
                Constraint::Min(10),
                Constraint::Length(2),
            ])
            .split(frame.area());

        let t = self.bus.cached();
        let tab_titles = vec![
            Line::from(format!(" __bh API ({}) ", self.entries.len())),
            Line::from(format!(" TARS ({}) ", self.tools.len())),
            Line::from(" TELEMETRY "),
        ];
        let tabs = Tabs::new(tab_titles)
            .select(self.tab)
            .block(
                Block::default()
                    .title(format!(
                        " BH-TUI [RUST/RATATUI] · {} @ {} · HDG {:03.0}° ",
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
        frame.render_widget(tabs, chunks[0]);

        let body = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(58), Constraint::Percentage(42)])
            .split(chunks[1]);

        match self.tab {
            0 => {
                let rows: Vec<Row> = self
                    .entries
                    .iter()
                    .map(|(n, k, p)| {
                        Row::new(vec![
                            Cell::from(n.as_str()).style(Style::default().fg(Color::White)),
                            Cell::from(k.as_str()).style(Style::default().fg(C_CYN)),
                            Cell::from(p.chars().take(36).collect::<String>())
                                .style(Style::default().fg(C_DIM)),
                        ])
                    })
                    .collect();
                let title = if self.bh_path.is_empty() {
                    " __bh (root) ".to_string()
                } else {
                    format!(" __bh.{} ", self.bh_path)
                };
                let table = Table::new(
                    rows,
                    [
                        Constraint::Length(20),
                        Constraint::Length(10),
                        Constraint::Min(10),
                    ],
                )
                .header(
                    Row::new(["MEMBER", "TYPE", "PREVIEW"])
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
                        .bg(Color::Rgb(16, 56, 76))
                        .fg(C_GRN)
                        .add_modifier(Modifier::BOLD),
                );
                frame.render_stateful_widget(table, body[0], &mut self.table_state);
            }
            1 => {
                let rows: Vec<Row> = self
                    .tools
                    .iter()
                    .map(|(n, d, _)| {
                        Row::new(vec![
                            Cell::from(n.as_str()).style(Style::default().fg(C_GRN)),
                            Cell::from(d.chars().take(48).collect::<String>())
                                .style(Style::default().fg(Color::White)),
                        ])
                    })
                    .collect();
                let table = Table::new(rows, [Constraint::Length(18), Constraint::Min(16)])
                    .header(
                        Row::new(["TARS TOOL", "DESCRIPTION"])
                            .style(Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
                    )
                    .block(
                        Block::default()
                            .title(" TARS TOOLS ")
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(C_GRN)),
                    )
                    .row_highlight_style(
                        Style::default()
                            .bg(Color::Rgb(16, 56, 76))
                            .fg(C_AMB)
                            .add_modifier(Modifier::BOLD),
                    );
                frame.render_stateful_widget(table, body[0], &mut self.table_state);
            }
            _ => {
                let txt = serde_json::to_string_pretty(t).unwrap_or_default();
                let para = Paragraph::new(txt)
                    .wrap(Wrap { trim: false })
                    .block(
                        Block::default()
                            .title(" /obc/telemetry.json ")
                            .borders(Borders::ALL)
                            .border_type(BorderType::Rounded)
                            .border_style(Style::default().fg(C_CYN)),
                    );
                frame.render_widget(para, body[0]);
            }
        }

        let inspector = Paragraph::new(self.inspect.as_str())
            .wrap(Wrap { trim: false })
            .block(
                Block::default()
                    .title(" INSPECTOR ")
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(C_DIM)),
            );
        frame.render_widget(inspector, body[1]);

        let footer = Paragraph::new(Line::from(vec![
            Span::styled(" [Tab] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Switch Tab  "),
            Span::styled(" [↑/↓] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Navigate  "),
            Span::styled(" [Enter] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Inspect/Open  "),
            Span::styled(" [Bksp] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Up  "),
            Span::styled(" [q] ", Style::default().fg(C_AMB).add_modifier(Modifier::BOLD)),
            Span::raw("Quit"),
        ]));
        frame.render_widget(footer, chunks[2]);
    }
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = TuiRunOpts::from_args(args);
    let mut app = BhTuiApp::new();
    run_tui(&mut app, opts, 120)
}
