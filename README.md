# rack-display

An animated face for the 2U 1280×400 touchscreen in my homelab mini rack. Its expression follows
what the Raspberry Pi k0s cluster is doing: calm when everything's healthy, focused while backups
run, dizzy when a pod crashloops, asleep at night. Swipe for the numbers behind it.

| Event | Face |
|---|---|
| All good | Calm, blinks, glances around |
| Pod crashloop | X eyes, orbiting stars |
| Node NotReady | One eye shut |
| Site down / cert expiring / firing alert | Wide eyes, "!" |
| Backup failed | Worried, sweat drop |
| Flux failed | Annoyed |
| Pi hot | Tired, red cheeks |
| High CPU | Strained, sweating, jittery |
| NAS parity check | Reading glasses |
| Backup running | Focused, eyeing a parcel |
| Flux reconciling | Looking up, thought dots |
| Torrents downloading | Looking down, arrows raining |
| Night (23:00–07:00) | Asleep, dimmed; warnings still wake it |
| Tapped | ^ ^ |

The most important active event drives the face. The rest show as chips in the corner.
Pages (swipe): face → status tiles → per-node CPU/temp/memory → sites, backups, NAS.

## Layout

- `web/`: the page (one self-contained `index.html`, canvas + DOM, no build step) and an nginx
  config that serves it and proxies **read-only** Prometheus queries (`GET /api/v1/query`,
  `/api/v1/query_range`). Image: `ghcr.io/0xjmart/rack-display/web`.
- `kiosk/`: Debian + [cage](https://github.com/cage-kiosk/cage) + seatd + Chromium in kiosk mode,
  run as a privileged pod on the node wired to the screen. Image: `ghcr.io/0xjmart/rack-display/kiosk`.

Both images are built for `linux/arm64` by GitHub Actions on every push to `main`, tagged
`sha-<short>` and `latest`. Kubernetes manifests live in the (private) Homelab GitOps repo and are
deployed by Flux.

## Running locally

Open `web/index.html` straight from disk: with no Prometheus it runs in mock mode, with a debug
panel to toggle every event. URL params:

| Param | |
|---|---|
| `?mock` | fake data + event toggles (default when opened from `file://`) |
| `?kiosk` | 1:1, no debug panel, no cursor |
| `?time=night` / `?time=day` | force night/day |
| `?demo` | cycle through every emote (mock) |
| `?glow=0` | disable the glow if the GPU struggles |

Against a real Prometheus:

```sh
docker build -t rack-web web
docker run -p 8080:8080 -e PROMETHEUS_URL=http://host.docker.internal:9090 rack-web
```

## Metrics used

kube-state-metrics, node-exporter, `ALERTS`, and `unraid_*` textfile metrics from the NAS. Flux
status, blackbox probes, UniFi PoE (unpoller) and Transmission aren't wired yet; their tiles show
"—" until those exporters exist.
