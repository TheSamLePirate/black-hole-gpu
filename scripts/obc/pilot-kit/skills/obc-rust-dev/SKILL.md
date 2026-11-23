---
name: obc-rust-dev
description: Develop, compile, lint, and test high-performance Rust + Ratatui + /dev/fb0 avionics programs directly inside the Unkernel aarch64 Linux OBC without hitting memory limits.
---

# Skill: Native Rust + Ratatui + `/dev/fb0` Development Inside the OBC

Use this skill when creating or compiling new Rust binaries inside `/home/pilot/`.

## Prerequisites
- Read `docs/TTY-AND-FB0.md` and `docs/UNKERNEL-LINUX.md`.
- Ensure Rust is installed:
  ```sh
  command -v rustc cargo || obc-install rust
  rustc --version && cargo --version
  ```
  *(Alpine 3.24 provides Rust 1.96 + `musl-dev`; Debian 13 provides Rust 1.85 + `gcc`/`libc6-dev`.)*

## Low-RAM Cargo Settings (Critical on 1–2 GiB VMs)
Always configure these env vars or `.cargo/config.toml` when compiling inside the guest:
```sh
export CARGO_BUILD_JOBS=1
export CARGO_INCREMENTAL=0
```
- Use `cargo build` (dev profile) during rapid iteration, and `cargo build --release` with `lto = "thin"` (or `false`) for fast, low-memory release builds. Only use `lto = "fat"` if the VM has ≥ 2 GiB RAM.
- For zero-dependency `/dev/fb0` or CLI tools, `rustc -O main.rs -o my-tool` compiles in **< 1 second** with tiny RAM usage!

## AAA Code Quality Standards
1. **Zero per-frame allocations** in `/dev/fb0` loops (`Vec<u32>` backbuffer allocated once, `FBIOGET_VSCREENINFO` + `libc::mmap`, RAII `munmap` in `Drop`).
2. **Safe `unsafe` boundaries**: Isolate `ioctl`, `mmap`, `munmap`, `termios`, and `poll` into a single small module with explicit `// SAFETY:` comments and RAII guards.
3. **Ratatui TUIs**: Follow the Elm/TEA pattern (`tick`, `on_key`, `draw`), implement `Viewport::Fixed(100×26)` fallback when `crossterm::terminal::size()` returns `< 40×12`, and add a `TestBackend` snapshot unit test (`cargo test`).
4. **Telemetry & RPC robustness**: Deserialize `/obc/telemetry.json` with `#[serde(default)]` and `.trim()` (fixed 2048-byte space-padded 9p file). Match exact RPC keys (`"result"`, `"toolArgs"`, `"kind"`).
5. **Lint & test before installing**:
   ```sh
   CARGO_BUILD_JOBS=1 cargo test
   cp target/release/<bin> "$HOME/.local/bin/<bin>"
   ```
