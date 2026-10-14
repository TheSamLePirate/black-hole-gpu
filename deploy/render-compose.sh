#!/bin/sh
# deploy/compose.yml with its images: render-compose.sh <site image> [<room server image>] > compose.yml
# (no room server image: its block left out)
set -eu
kerr="$1"
rooms="${2:-}"
dir=$(dirname "$0")
if [ -n "$rooms" ]; then
  sed -e "s|__KERR_IMAGE__|$kerr|" -e "s|__ROOMS_IMAGE__|$rooms|" "$dir/compose.yml"
else
  sed -e "s|__KERR_IMAGE__|$kerr|" -e '/^# rooms-begin$/,/^# rooms-end$/d' "$dir/compose.yml"
fi
