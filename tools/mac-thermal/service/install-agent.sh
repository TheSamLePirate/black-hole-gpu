#!/bin/sh
# The user half of the thermal service (docs/THERMAL.md), no sudo — the collector as a LaunchAgent:
#   sh ~/.local/share/kerr-thermal/install-agent.sh              install (or update) and start
#   sh ~/.local/share/kerr-thermal/install-agent.sh --uninstall  stop and remove
# Put there (with mac-thermal.js, the toolkit bundled, and the root half) by `bun scripts/thermal.ts install [--host h]`.
# The agent: `bun mac-thermal.js service` — one macmon streaming, a snapshot every 5 s into
# ~/.local/state/kerr-thermal/{latest.json,history.jsonl}; powermetrics' figures too once install-root.sh has run.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LABEL=org.samlepirate.kerr-thermal
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
STATE=$HOME/.local/state/kerr-thermal
BUN=${BUN:-$HOME/.bun/bin/bun}
INTERVAL_MS=${KERR_THERMAL_INTERVAL_MS:-5000}
DOMAIN=gui/$(id -u)
SEARCH=/opt/homebrew/bin:/usr/local/bin:$PATH

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST"
  echo "kerr-thermal agent removed (its files kept in $STATE)"
  exit 0
fi
[ "$(uname -s)/$(uname -m)" = "Darwin/arm64" ] || { echo "macOS on Apple Silicon only" >&2; exit 1; }
[ -x "$BUN" ] || { echo "bun not found at $BUN (BUN=/path/to/bun sh $0)" >&2; exit 1; }
[ -f "$HERE/mac-thermal.js" ] || { echo "mac-thermal.js not beside $0 — bun scripts/thermal.ts install" >&2; exit 1; }
MACMON=$(PATH=$SEARCH command -v macmon || true)
if [ -z "$MACMON" ]; then
  BREW=$(PATH=$SEARCH command -v brew || true)
  [ -n "$BREW" ] || { echo "macmon missing and no Homebrew to install it" >&2; exit 1; }
  echo "installing macmon (Homebrew)…"
  HOMEBREW_NO_AUTO_UPDATE=1 "$BREW" install macmon
  MACMON=$(PATH=$SEARCH command -v macmon)
fi

mkdir -p "$STATE" "$HOME/Library/LaunchAgents"
chmod 700 "$STATE"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string><string>$HERE/mac-thermal.js</string><string>service</string>
    <string>--interval</string><string>$INTERVAL_MS</string>
    <string>--latest</string><string>$STATE/latest.json</string>
    <string>--log</string><string>$STATE/history.jsonl</string>
    <string>--quiet</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$MACMON"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>WorkingDirectory</key><string>$STATE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$STATE/agent.log</string>
</dict>
</plist>
EOF
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"

# (its first sample: macmon's start, then one interval)
i=0
while [ $i -lt 30 ] && [ ! -s "$STATE/latest.json" -o "$STATE/latest.json" -ot "$PLIST" ]; do sleep 1; i=$((i + 1)); done
if [ -s "$STATE/latest.json" ] && [ ! "$STATE/latest.json" -ot "$PLIST" ]; then
  echo "kerr-thermal agent running: $STATE/latest.json"
  if [ -s /var/run/kerr-thermal/powermetrics.txt ]; then echo "root feed: present"; else
    echo "root feed: absent — for powermetrics' figures, once: sudo sh $HERE/install-root.sh"
  fi
else
  echo "no sample after 30 s — see $STATE/agent.log and: launchctl print $DOMAIN/$LABEL" >&2
  exit 1
fi
