# Chromium in kiosk mode on the Pi's HDMI output, under the cage Wayland compositor.
# Runs privileged on the display node with /dev/dri, /dev/input and /run/udev mounted.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      cage seatd wlr-randr chromium fonts-inter fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -f input && groupadd -f render \
 && useradd --create-home --groups video,input,render kiosk
COPY entrypoint.sh session.sh /usr/local/bin/
# cage draws a cursor mid-screen even with no mouse attached; this theme makes it invisible.
COPY blank-cursor /usr/share/icons/blank
# Any cursor name the theme lacks (Chromium's "progress" while a page loads, "pointer", "text"…)
# falls back to Adwaita and shows up, so point every name Adwaita has at the blank one.
RUN for c in /usr/share/icons/Adwaita/cursors/*; do \
      n=$(basename "$c"); [ -e "/usr/share/icons/blank/cursors/$n" ] || ln -s left_ptr "/usr/share/icons/blank/cursors/$n"; \
    done \
 # cage (and libwayland-cursor without a theme name) load the "default" theme, not XCURSOR_THEME,
 # and Debian's default inherits Adwaita, so make default blank too.
 && printf '[Icon Theme]\nInherits=blank\n' > /usr/share/icons/default/index.theme
ENV KIOSK_URL=http://rack-display-web.rack-display.svc.cluster.local/?kiosk \
    KIOSK_ROTATE=0
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
