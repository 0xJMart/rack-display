# Chromium in kiosk mode on the Pi's HDMI output, under the cage Wayland compositor.
# Runs privileged on the display node with /dev/dri, /dev/input and /run/udev mounted.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      cage seatd chromium fonts-inter fonts-dejavu-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -f input && groupadd -f render \
 && useradd --create-home --groups video,input,render kiosk
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
ENV KIOSK_URL=http://rack-display-web.rack-display.svc.cluster.local/?kiosk
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
