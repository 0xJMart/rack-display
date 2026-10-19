#!/bin/sh
# Runs inside cage as the kiosk user: rotate the output if asked, then start Chromium.
# Rotating in the compositor (not CSS) keeps touch input and swipes lined up with the picture.
set -u

if [ -n "${KIOSK_ROTATE:-}" ] && [ "$KIOSK_ROTATE" != "0" ]; then
  out=$(wlr-randr | awk '/^[^ ]/ {print $1; exit}')
  wlr-randr --output "$out" --transform "$KIOSK_ROTATE" || echo "rotate $out to $KIOSK_ROTATE failed" >&2
fi

exec chromium \
    --kiosk --ozone-platform=wayland --touch-events=enabled \
    --noerrdialogs --disable-infobars --no-first-run --disable-translate \
    --disable-features=TranslateUI,MediaRouter --disable-session-crashed-bubble \
    --check-for-update-interval=31536000 --password-store=basic \
    --user-data-dir=/tmp/chromium \
    "$KIOSK_URL"
