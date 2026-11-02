#!/bin/sh
# Once per Mac, with sudo — the root half of the thermal service (docs/THERMAL.md):
#   sudo sh ~/.local/share/kerr-thermal/install-root.sh              install (or update) and start
#   sudo sh ~/.local/share/kerr-thermal/install-root.sh --uninstall  stop and remove
# What it installs: powermetrics-feed.sh copied root-owned to /Library/PrivilegedHelperTools/ and a LaunchDaemon
# running it (powermetrics alone, every 5 s → /var/run/kerr-thermal/powermetrics.txt). No sudoers change, no
# password kept, no bun nor repository code run as root: what runs is the copy, which the user cannot edit.
set -eu
[ "$(id -u)" = 0 ] || { echo "run it with sudo: sudo sh $0" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
LABEL=org.samlepirate.kerr-thermal-feed
PLIST=/Library/LaunchDaemons/$LABEL.plist
HELPER=/Library/PrivilegedHelperTools/$LABEL.sh
INTERVAL_MS=5000

launchctl bootout "system/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST" "$HELPER"
  rm -rf /var/run/kerr-thermal
  echo "kerr-thermal feed removed"
  exit 0
fi
[ -f "$HERE/powermetrics-feed.sh" ] || { echo "powermetrics-feed.sh not beside $0" >&2; exit 1; }
[ -x /usr/bin/powermetrics ] || { echo "/usr/bin/powermetrics missing" >&2; exit 1; }

mkdir -p /Library/PrivilegedHelperTools
install -o root -g wheel -m 755 "$HERE/powermetrics-feed.sh" "$HELPER"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>$HELPER</string><string>$INTERVAL_MS</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>StandardErrorPath</key><string>/var/log/kerr-thermal-feed.log</string>
</dict>
</plist>
EOF
chown root:wheel "$PLIST"
chmod 644 "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootstrap system "$PLIST"

# (its first sample: one interval and powermetrics' start)
i=0
while [ $i -lt 20 ] && [ ! -s /var/run/kerr-thermal/powermetrics.txt ]; do sleep 1; i=$((i + 1)); done
if [ -s /var/run/kerr-thermal/powermetrics.txt ]; then
  echo "kerr-thermal feed running: /var/run/kerr-thermal/powermetrics.txt"
  grep -E "pressure level|GPU HW active frequency|GPU HW active residency" /var/run/kerr-thermal/powermetrics.txt || true
else
  echo "no sample after 20 s — see /var/log/kerr-thermal-feed.log and: launchctl print system/$LABEL" >&2
  exit 1
fi
