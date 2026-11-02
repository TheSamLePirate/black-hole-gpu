# Mac Thermal CLI — agent usage contract

This is a local Bun CLI, not a server. Do not start a web service or MCP server. It observes telemetry; it does not run stress tests, change fans, power settings, sudoers or application workloads.

Use `dist/mac-thermal.js` as a standalone entry point. It needs Bun and macmon on macOS Apple Silicon, but no JavaScript package installation. The source entry point is the sibling `../mac-thermal.ts`, with this toolkit directory alongside it.

## In this repository: the service (read this first)

On the lab's Macs a LaunchAgent already runs `service` (docs/THERMAL.md): one macmon streaming, a snapshot every 5 s in
`~/.local/state/kerr-thermal/latest.json` and `history.jsonl`. Do not start `monitor` or a second collector; read:

```bash
bun scripts/thermal.ts                      # one line: pressure, GPU clock / max, temperatures, power
bun ~/.local/share/kerr-thermal/mac-thermal.js latest ~/.local/state/kerr-thermal/latest.json --max-age 15
```

`thermal.pressure` comes from powermetrics when the root feed runs (`/var/run/kerr-thermal/powermetrics.txt`, written by
a LaunchDaemon a human installed once with `sudo sh install-root.sh`), else from the OS (`notifyutil -g
com.apple.system.thermalpressurelevel`, no root, the same OSThermalPressureLevel): `thermal.pressureSource` says which.
Any command here reads that feed instead of sudo when it is fresher than 15 s (`MAC_THERMAL_POWER_FEED`, `none` to skip).

## Discover before collecting

```bash
bun /absolute/path/mac-thermal.js help
bun /absolute/path/mac-thermal.js doctor
bun /absolute/path/mac-thermal.js catalog
bun /absolute/path/mac-thermal.js schema
```

`doctor` probes OS, installed macmon version, supported powermetrics samplers and current noninteractive sudo access. Authorization is specific to the process/terminal context and may expire. An authenticated shell does not automatically authorize a GUI-launched agent.

## One bounded snapshot

```bash
bun /absolute/path/mac-thermal.js snapshot --power auto --interval 1000
bun /absolute/path/mac-thermal.js snapshot --power off --metrics 'gpu.*'
```

`auto` returns partial telemetry when sudo access is unavailable, without asking for a password. `required` fails with `AUTH_REQUIRED` if privileged telemetry cannot be collected. `off` disables powermetrics. The default snapshot interval is 1000 ms. Initialization overhead means real elapsed time is longer; allow roughly 30 seconds for the entire command, rather than assuming a 1-second execution.

New CLI commands always emit JSON, without ANSI escape sequences. No password is accepted as a flag or environment variable. Never ask a user to paste a password into chat.

## Full telemetry through a human-started collector

A human runs this in an interactive terminal:

```bash
bun /absolute/path/mac-thermal.js monitor --power required \
  --latest /absolute/path/thermal-latest.json \
  --log /absolute/path/thermal-history.jsonl --quiet
```

The terminal asks through sudo when needed. The collector remains an ordinary user process and elevates only fixed, bounded powermetrics commands. It refreshes its own sudo credential timestamp while it is running. No network endpoint is opened. Default runtime is 3600 seconds; `--duration` accepts up to 86400 seconds. Ctrl+C stops it and releases its file locks.

The agent then reads:

```bash
bun /absolute/path/mac-thermal.js latest /absolute/path/thermal-latest.json --max-age 15
bun /absolute/path/mac-thermal.js latest /absolute/path/thermal-latest.json --max-age 15 --metrics 'gpu.*'
```

Do not silently increase `--max-age` after a stale-file error. Investigate whether the collector stopped. Reading a file does not trigger a new sensor collection. Freshness is measured from sample completion, not from the instant all sources were read. The sources are not synchronized.

`latest` removes raw source dumps unless `--raw` is explicitly requested. Use the CLI for freshness validation rather than treating an arbitrary old JSON file as current state.

## Recording and analysis

```bash
bun /absolute/path/mac-thermal.js record --power auto --samples 5 --interval 1000 \
  --duration 60 --label 'same rendering workload' --out /absolute/path/session.json
bun /absolute/path/mac-thermal.js analyze /absolute/path/session.json --metrics 'gpu.*'
bun /absolute/path/mac-thermal.js analyze /absolute/path/thermal-history.jsonl
bun /absolute/path/mac-thermal.js compare /absolute/path/baseline.json /absolute/path/candidate.json --same-workload
```

`record` returns a summary by default. `--out` preserves the complete session; `--include-samples` additionally prints its samples to stdout. Avoid sending complete sample arrays or raw dumps into the model context unless needed. Record at most 120 samples over a maximum 600-second collection; raw recordings are limited to 10 samples. For longer observations, use the bounded `monitor` and its rotating JSONL log.

Statistics exclude missing values. The mean is sample-weighted, not time-weighted. Percentiles use linear interpolation. Regression slopes use actual sample completion times and require at least 3 valid points. High-frequency readings from different source windows are not interchangeable. Pressure histograms count snapshots, not seconds spent at a thermal level.

`compare` reports deltas; it never proves thermal causality. `--same-workload` is a caller declaration, not a measured guarantee. Large activity differences, hardware/OS differences and unobserved ambient/cooling/AC/workload factors limit comparison. Matching model/chip/OS does not prove that two captures came from the same physical machine.

## Interpret the schema correctly

- Check `sources` and `coverage` before interpreting values. Exit 0 can have partial telemetry.
- `null` means unavailable; it never means zero, healthy, idle or nonexistent hardware.
- Each metric has `value`, `unit`, `source`, `quality` and `unavailableReason`.
- `reported` means the tool/driver reported the value, not that it is physically verified. `estimated` covers power estimates. `derived` is a documented calculation.
- Numeric sanity bounds in the catalog are parser validation bounds, **not thermal operating limits**.
- `gpu.active_percent` is active-time residency, not ALU utilization, memory bandwidth, occupancy or workload throughput.
- `gpu.scaled_percent` is frequency-scaled activity, not idle time. A scaled value of 89% can coexist with 100% active residency.
- Device/Renderer/Tiler driver counters have undocumented update windows, may overlap, and must not be added or used to classify compute vs graphics.
- GPU memory is unified system memory. Allocated bytes are not a dedicated VRAM capacity or necessarily resident physical memory.
- Low clocks, a high temperature, nonzero swap, `fair`, or `Moderate` alone do not prove hardware thermal throttling.
- `thermal.hardwareThrottling` intentionally remains `unknown`. Findings distinguish observations, heuristic inferences and limitations, with evidence paths.
- `gpu_continuously_active` uses a 95% residency threshold. `busy_gpu_below_reported_maximum` uses <90% of the declared maximum while active >=95%. These are diagnostic heuristics, not Apple thermal thresholds.
- An empty fans array means no readable fan entries were supplied; it does not mean the Mac has no fans or that they are stopped.
- An absence of historical pmset warnings is not proof of current unrestricted performance.
- Field selection changes only returned metrics. `coverage` still describes the complete catalog; `selection` identifies selected IDs. Findings may refer to filtered metrics, recoverable through a wider selection.
- `sourceReadEndSkewMs` measures the spread in completion times; it does not reveal the private driver's actual refresh time.

## Error handling

Errors use `{schemaVersion, kind:"error", error:{code,message,retryable,remedy,details?}}`.

| Exit | Meaning | Agent action |
|---|---|---|
| 0 | Success, potentially partial | Inspect sources and metric coverage |
| 1 | Internal failure | Report the error; preserve evidence |
| 2 | Invalid input/history/schema | Correct arguments or file; do not retry unchanged |
| 3 | Auth/privileged source unavailable | Use `auto`, or ask the human to start the terminal collector |
| 4 | Unsupported platform | Report the compatibility limit |
| 5 | Required telemetry, file lock or strict coverage unavailable | Inspect code/remedy; bounded retries only |
| 6 | Stale sample or clock skew | Check the collector and system time |
| 130 | Interrupted | Stop dependent work or use the preserved partial recording |

Do not retry indefinitely. A failed required source can include a usable partial snapshot in `error.details.partialSnapshot`. `--require-complete` is stricter than `--power required`: it requires every catalog metric, including fields often not exposed by this OS.

Offline analysis accepts v2 snapshots, v2 sessions containing samples, arrays of v2 snapshots and v2 JSONL logs. Limits: 16 MiB input and 5000 rows. Exact duplicate IDs are deduplicated; conflicting IDs, mixed model/chip/OS histories, invalid units/ranges and truncated final JSONL lines are rejected. V1 dashboard logs do not silently migrate into v2 analysis.

## Files and operational limits

`monitor` publishes its latest snapshot through an atomic rename. New files use mode 0600. The JSONL log rotates at 8 MiB into `.1` and `.2`; each record remains complete. Active file locks prevent a second collector from writing the same paths. Source commands have deadlines, cancellation and a 2 MiB per-stream output limit; a raw snapshot is limited to 4 MiB. No unbounded cache or background daemon is installed.

The human dashboard remains available by running the entry point without a subcommand. Its legacy flags/JSON format are preserved for compatibility; use the named commands above for the versioned agent contract.
