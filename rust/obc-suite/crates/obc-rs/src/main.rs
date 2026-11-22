//! Multi-call native aarch64 Rust + Ratatui & `/dev/fb0` avionics suite (`obc-rs`).
//! Dispatches either by symlink/argv[0] basename (`bh-tui`, `obc-pfd-fb`, ...) or explicit subcommand.

use anyhow::{Result, bail};
use std::env;
use std::path::Path;

const APPS: &[(&str, &str)] = &[
    ("bh-tui", "Ratatui universal __bh API & 73 TARS Tools Explorer"),
    ("obc-top", "Ratatui real-time avionics htop with Sparklines & Gauges"),
    ("obc-mission-tui", "Ratatui orbital flight director with Braille Canvas"),
    ("obc-fmc-tui", "Ratatui Flight Management Computer & ILS monitor"),
    ("obc-f35-tui", "Ratatui F-35B/C WSO Tactical & Radar Console"),
    ("obc-a320-tui", "Ratatui Airbus A320 FCU + Live Captain MCDU & ECAM"),
    ("obc-pfd-fb", "Native /dev/fb0 1:1 Primary Flight Display (30-60 Hz)"),
    ("obc-f35-fb", "Native /dev/fb0 F-35 TSD & AN/APG-81 Tactical Radar"),
    ("obc-a320-fb", "Native /dev/fb0 Airbus A320 ARC Navigation Display"),
    ("obc-ils-fb", "Native /dev/fb0 Split Plan View + 3° Glidepath Profile"),
    ("obc-radar-fb", "Native /dev/fb0 Orbital & Tactical Phosphor Scope"),
    ("obc-kerr-fb", "Native /dev/fb0 Gargantua Relativistic Kerr Visualizer"),
];

fn dispatch(app: &str, args: &[String]) -> Result<()> {
    match app {
        "bh-tui" => obc_tui::bh_tui::run(args),
        "obc-top" | "top" => obc_tui::top::run(args),
        "obc-mission-tui" | "mission-tui" => obc_tui::mission::run(args),
        "obc-fmc-tui" | "fmc-tui" => obc_tui::fmc::run(args),
        "obc-f35-tui" | "f35-tui" => obc_tui::f35_tui::run(args),
        "obc-a320-tui" | "a320-tui" => obc_tui::a320_tui::run(args),
        "obc-pfd-fb" | "pfd-fb" => obc_fb::pfd::run(args),
        "obc-f35-fb" | "f35-fb" => obc_fb::f35::run(args),
        "obc-a320-fb" | "a320-fb" => obc_fb::a320::run(args),
        "obc-ils-fb" | "ils-fb" => obc_fb::ils::run(args),
        "obc-radar-fb" | "radar-fb" => obc_fb::radar::run(args),
        "obc-kerr-fb" | "kerr-fb" => obc_fb::kerr::run(args),
        _ => bail!("unknown obc-rs applet: {app} (run `obc-rs --list`)"),
    }
}

fn main() -> Result<()> {
    let argv: Vec<String> = env::args().collect();
    let prog = argv
        .first()
        .and_then(|s| Path::new(s).file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("obc-rs");

    if prog != "obc-rs" && APPS.iter().any(|(name, _)| *name == prog) {
        return dispatch(prog, &argv[1..]);
    }

    let Some(sub) = argv.get(1).map(String::as_str) else {
        print_help();
        return Ok(());
    };
    match sub {
        "--version" | "-V" => {
            println!("obc-rs {} (rust + ratatui + /dev/fb0 aarch64)", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        "--list" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => dispatch(other, &argv[2..]),
    }
}

fn print_help() {
    println!("obc-rs {} — Native Rust + Ratatui & /dev/fb0 Avionics Suite", env!("CARGO_PKG_VERSION"));
    println!("Usage: obc-rs <applet> [args...]");
    for (name, desc) in APPS {
        println!("  {name:<18} {desc}");
    }
}
