#!/bin/sh
# The root half of the thermal service (docs/THERMAL.md): powermetrics' samples, one every INTERVAL ms, written
# atomically to /var/run/kerr-thermal/powermetrics.txt (0644), where the user's collector reads them — no sudo there.
# Nothing else runs as root: no bun, no repository code. install-root.sh copies this file root-owned to
# /Library/PrivilegedHelperTools/ and launchd (org.samlepirate.kerr-thermal-feed) keeps it running.
set -u
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH LC_ALL=C LANG=C
INTERVAL_MS=${1:-5000}
case $INTERVAL_MS in '' | *[!0-9]*) INTERVAL_MS=5000 ;; esac
[ "$INTERVAL_MS" -ge 1000 ] || INTERVAL_MS=1000
DIR=/var/run/kerr-thermal
OUT=$DIR/powermetrics.txt
umask 022
# (/var/run is root's: the folder made fresh, root-owned, at each start — /var/run empties at boot)
[ -L "$DIR" ] && rm -f "$DIR"
mkdir -p "$DIR" && chown root:wheel "$DIR" && chmod 755 "$DIR" || exit 1
# (the samplers and flags this macOS has, as the toolkit's capabilities() picks them)
HELP=$(powermetrics --help 2>&1)
SAMPLERS=""
for s in thermal cpu_power gpu_power ane_power sfi battery smc; do
  if printf '%s\n' "$HELP" | grep -Eq "^[[:space:]]+$s[[:space:]]"; then SAMPLERS="${SAMPLERS:+$SAMPLERS,}$s"; fi
done
[ -n "$SAMPLERS" ] || { echo "powermetrics: no sampler found" >&2; sleep 60; exit 1; }
FLAGS=""
for f in --show-plimits --show-extra-power-info; do
  case $HELP in *"$f"*) FLAGS="$FLAGS $f" ;; esac
done
echo "$(date -u +%FT%TZ) feed: samplers $SAMPLERS, every $INTERVAL_MS ms, streaming →$FLAGS $OUT" >&2
# One powermetrics streaming (-n -1, line-buffered), cut into samples: each written whole to .next then renamed
# over $OUT. Not `-n 1` in a loop — every start costs powermetrics 2–4.5 s of CPU (IOReport's set-up, measured
# 2026-11-02), a third of a core at 5 s; streaming, only the samples cost. A sample ends at the GPU section's
# "GPU Power:" (gpu_power is the last sampler printed; what follows, blank lines, is dropped until the next header),
# else at the next sample's header; one cut by the stream's end is dropped (the last whole one stays).
while :; do
  # shellcheck disable=SC2086 # (FLAGS: words on purpose)
  powermetrics --samplers "$SAMPLERS" -i "$INTERVAL_MS" -n -1 -b 1 $FLAGS 2>/dev/null | awk -v dir="$DIR" '
    function publish() {
      if (n) { close(tmp); system("mv -f " tmp " " out) }
      n = 0
    }
    BEGIN { tmp = dir "/.next"; out = dir "/powermetrics.txt"; n = 0; section = "" }
    /^\*\*\* Sampled system activity/ { publish(); started = 1 }
    !started { next }
    /^\*\*\*\* .* \*\*\*\*$/ { section = $0 }
    { print > tmp; n++ }
    section ~ /GPU usage/ && /^GPU Power:/ { publish(); section = ""; started = 0 }
    END { if (n) { close(tmp); system("rm -f " tmp) } }'
  echo "$(date -u +%FT%TZ) feed: powermetrics stopped — restarting in 5 s" >&2
  sleep 5
done
