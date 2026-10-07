#!/bin/sh
# seatd (root) hands DRM/input devices to cage, which runs as the unprivileged kiosk user.
set -eu

export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR"
chown kiosk:kiosk "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

seatd -g kiosk &
for i in $(seq 1 50); do [ -S /run/seatd.sock ] && break; sleep 0.1; done

export LIBSEAT_BACKEND=seatd
export WLR_LIBINPUT_NO_DEVICES=1      # still start if the touch cable isn't connected
export WLR_NO_HARDWARE_CURSORS=1

# cage exits when Chromium does; the pod restarts and brings both back.
exec runuser -u kiosk -- cage -d -- chromium \
    --kiosk --ozone-platform=wayland --touch-events=enabled \
    --noerrdialogs --disable-infobars --no-first-run --disable-translate \
    --disable-features=TranslateUI,MediaRouter --disable-session-crashed-bubble \
    --check-for-update-interval=31536000 --password-store=basic \
    --user-data-dir=/tmp/chromium \
    "$KIOSK_URL"
