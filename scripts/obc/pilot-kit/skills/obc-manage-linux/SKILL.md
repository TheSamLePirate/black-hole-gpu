---
name: obc-manage-linux
description: Administer the Unkernel aarch64 Linux OBC (Alpine 3.24 and Debian 13), install toolchains and packages, diagnose Wisp networking, manage RAM/disk persistence, and publish new CLI tools.
---

# Skill: Manage the Unkernel Linux OBC Environment

Use this skill whenever installing tools/packages, troubleshooting networking/PATH/OOM issues, or organizing persistent software in `/home/pilot`.

## Prerequisites
- Read `docs/UNKERNEL-LINUX.md`.

## Standard System Inspection
```sh
obc-diag                        # Kernel, distro, RAM, telemetry, installed toolchains
cat /obc/status.json            # Host runtime status (distro, memoryMiB, wispUrl, fbActive)
free -m && df -h /home/pilot /tmp
cat /etc/os-release
```

## Installing Languages, Agents & Packages
1. **Built-in curated toolchains** (preferred — works identically on Alpine & Debian):
   - `obc-install python | node | bun | rust | pi | claude | all`
2. **OS packages**:
   - Alpine 3.24: `apk update && apk add --no-cache <pkg>`
   - Debian 13: `apt-get update && apt-get install -y --no-install-recommends <pkg>`
3. **Python / Node packages**:
   - Python: `pip install --break-system-packages <pkg>` (or create a venv in `/home/pilot/.venv`).
   - Node: `npm install -g <pkg>` (use `--ignore-scripts` if a package tries to run unsupported native postinstall hooks).

## Troubleshooting Checklist
- **Command hits Unkernel stub instead of real binary**: Check `which -a <cmd>` — ensure `/usr/lib/kw/bin` is at the END of `PATH` (source `/etc/profile.d/obc.sh`).
- **Network / TLS failure**: Verify `netEnabled: true` in `/obc/status.json`, then test `curl -fsSI https://code.samlepirate.org/health`. Remember raw ICMP `ping` is unsupported over Wisp v1 TCP relay.
- **OOM during builds or npm/cargo**: Check `free -m`, clean `/tmp`, set `CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0`, or advise the pilot to switch RAM to 2 GiB / 4 GiB in HUD Options.
- **Publishing a new persistent CLI**: Keep source in `/home/pilot/<project>`, `chmod 755` the executable, and symlink into `$HOME/.local/bin/<cmd>` so it is immediately on `PATH`.
