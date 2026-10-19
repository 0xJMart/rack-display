#!/bin/sh
# Runs inside cage as the kiosk user: rotate the output if asked, then start Chromium.
# Rotating in the compositor (not CSS) keeps touch input and swipes lined up with the picture.
set -u

# The screen may have no power when cage starts, or be replugged later, so keep checking and
# rotate any output whose transform isn't the one asked for.
if [ -n "${KIOSK_ROTATE:-}" ] && [ "$KIOSK_ROTATE" != "0" ]; then
  (
    while :; do
      wlr-randr 2>/dev/null | awk '/^[^ ]/ {out=$1} /^  Transform:/ {print out, $2}' |
        while read -r out cur; do
          [ "$cur" = "$KIOSK_ROTATE" ] && continue
          wlr-randr --output "$out" --transform "$KIOSK_ROTATE" && echo "rotated $out to $KIOSK_ROTATE" >&2
        done
      sleep 5
    done
  ) &
fi

exec chromium \
    --kiosk --ozone-platform=wayland --touch-events=enabled \
    --noerrdialogs --disable-infobars --no-first-run --disable-translate \
    --disable-features=TranslateUI,MediaRouter --disable-session-crashed-bubble \
    --check-for-update-interval=31536000 --password-store=basic \
    --user-data-dir=/tmp/chromium \
    "$KIOSK_URL"
