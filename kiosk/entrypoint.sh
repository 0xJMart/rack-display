#!/bin/sh
# seatd (root) hands DRM/input devices to cage, which runs as the unprivileged kiosk user.
set -eu

export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR"
chown kiosk:kiosk "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"

# The host's device group IDs (render is 992 on Pi OS) don't match the image's, so join
# whatever groups own the mounted devices. Without this EGL can't open renderD128 and
# cage falls back to software rendering.
for dev in /dev/dri/* /dev/input/event*; do
  [ -c "$dev" ] || continue
  gid=$(stat -c %g "$dev"); [ "$gid" -ne 0 ] || continue
  getent group "$gid" >/dev/null || groupadd -g "$gid" "host$gid"
  usermod -aG "$(getent group "$gid" | cut -d: -f1)" kiosk
done

seatd -g kiosk &
for i in $(seq 1 50); do [ -S /run/seatd.sock ] && break; sleep 0.1; done

export LIBSEAT_BACKEND=seatd
export WLR_LIBINPUT_NO_DEVICES=1      # still start if the touch cable isn't connected
export WLR_NO_HARDWARE_CURSORS=1
export XCURSOR_THEME=blank XCURSOR_SIZE=24  # see blank-cursor/

# cage exits when Chromium does; the pod restarts and brings both back.
exec runuser -u kiosk -- cage -d -- /usr/local/bin/session.sh
