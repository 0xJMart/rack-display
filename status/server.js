// Widget status service: computes the rack face's state with the page's own logic (events.js)
// and serves only that summary as JSON, for the iPhone widget (widget/rack-face.js).
//   GET /widget/status   Authorization: Bearer <token>   -> face state (no raw Prometheus access)
//   GET /public/status   no auth, cacheable -> sanitized summary for the resume site (see public.js)
//                        incl. that site's uptime from its blackbox probe (UPTIME_URL, UPTIME_WINDOW_DAYS,
//                        UPTIME_SINCE = go-live time, so probes from before the site was public don't count)
//   GET /healthz
// Env: PROMETHEUS_URL, ALERTMANAGER_URL, WIDGET_TOKEN_FILE, PORT (8081), TZ (night = 23:00–07:00 here)
'use strict';
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const RS = require('./events.js');
const { toPublic, uptimeFrom } = require('./public.js');

const PROM = process.env.PROMETHEUS_URL || 'http://prometheus-stack-kube-prom-prometheus.monitoring.svc:9090';
const AM = process.env.ALERTMANAGER_URL || 'http://prometheus-stack-kube-prom-alertmanager.monitoring.svc:9093';
const PORT = +(process.env.PORT || 8081);
const POLL_MS = 30_000;
const UPTIME_URL = process.env.UPTIME_URL || 'https://joe-martinez.com/';
const UPTIME_DAYS = +(process.env.UPTIME_WINDOW_DAYS || 7);   // keep within Prometheus retention
const UPTIME_SINCE = Date.parse(process.env.UPTIME_SINCE || '') / 1000;   // NaN = no lower bound
const PROBE_INTERVAL_S = 60;                                     // the sites Probe's interval
const UPTIME_MS = 5 * 60_000;
const TOKEN = fs.readFileSync(process.env.WIDGET_TOKEN_FILE || '/etc/widget/token', 'utf8').trim();
if (TOKEN.length < 32) throw new Error('widget token missing or shorter than 32 characters');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const getJSON = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};
const prom = async (query) => {
  const j = await getJSON(`${PROM}/api/v1/query?` + new URLSearchParams({ query }));
  if (j.status !== 'success') throw new Error(j.error || 'query failed');
  return j.data.result;
};
const amAlerts = async () => (await getJSON(`${AM}/api/v2/alerts?active=true&silenced=true&inhibited=true`))
  .map(a => ({ labels: a.labels, suppressed: a.status.state === 'suppressed' }));

const isNight = () => { const h = new Date().getHours(); return h >= 23 || h < 7; };   // TZ from env

let fluxBefore = { failed: new Set(), busy: new Set() };
let snapshot = null;   // last good state
let lastOk = 0, lastErr = '';

async function poll() {
  const keys = Object.keys(RS.LQ);
  const res = await Promise.allSettled(keys.map(k => prom(RS.LQ[k])));
  const R = {};
  keys.forEach((k, i) => { R[k] = res[i].status === 'fulfilled' ? res[i].value : null; });
  const failed = res.filter(r => r.status === 'rejected');
  lastErr = failed.length ? `${failed.length}/${res.length} queries failed (${failed[0].reason.message})` : '';
  if (failed.length === res.length) { log('poll:', lastErr); return; }
  let am = null;
  try { am = await amAlerts(); } catch (e) { lastErr = [lastErr, `alertmanager: ${e.message}`].filter(Boolean).join(' · '); }
  const d = RS.derive(R, am, fluxBefore);
  fluxBefore = d.fluxBefore;
  snapshot = d.state;
  lastOk = Date.now();
}

function current() {
  // No good poll in 2 minutes -> the same "can't reach Prometheus" event the page shows
  const stale = !snapshot || Date.now() - lastOk > 120_000;
  const S = snapshot ? { ...snapshot, stale } : { stale: true, pods: { bad: [] }, nodes: [], alerts: [], silenced: [], backup: {} };
  const evs = RS.events(S);
  const night = isNight();
  return { S, evs, night, stale, emote: RS.emoteFor(evs, night) };
}

let uptime = null;
async function pollUptime() {
  const now = Date.now() / 1000;
  const span = Math.floor(Math.min(UPTIME_DAYS * 86400, Number.isFinite(UPTIME_SINCE) ? now - UPTIME_SINCE : Infinity));
  if (span < PROBE_INTERVAL_S) { uptime = null; return; }
  const sel = `probe_success{instance=${JSON.stringify(UPTIME_URL)}}`, w = `${span}s`;
  const [ok, samples, first] = await Promise.all([
    prom(`sum_over_time(${sel}[${w}])`),
    prom(`count_over_time(${sel}[${w}])`),
    prom(`min_over_time(timestamp(${sel})[${w}:1m])`),
  ]);
  const num = (r) => (r?.[0] ? +r[0].value[1] : NaN);
  const u = uptimeFrom({ ok: num(ok), samples: num(samples), first: num(first) }, now, PROBE_INTERVAL_S);
  uptime = u && { ...u, windowDays: UPTIME_DAYS };
}

function publicStatus() {
  const { S, night, stale, emote } = current();
  return toPublic(S, { emote, night, stale, uptime, updated: lastOk ? new Date(lastOk).toISOString() : null });
}

function status() {
  const { S, evs, night, stale, emote } = current();
  const lead = evs[0] || null;
  const up = S.nodes.filter(n => n.ready);
  return {
    updated: lastOk ? new Date(lastOk).toISOString() : null,
    stale,
    night,
    emote,
    face: { ...RS.BASE, ...RS.EMO[emote], dream: emote === 'sleep' && lead ? RS.DREAM[lead.id] || null : null },
    lead: lead && { id: lead.id, sev: lead.sev, label: lead.label, progress: lead.progress ?? null },
    events: evs.slice(0, 5).map(e => ({ id: e.id, sev: e.sev, label: e.label })),
    counts: { bad: evs.filter(e => e.sev === 'bad').length, warn: evs.filter(e => e.sev === 'warn').length,
      info: evs.filter(e => e.sev === 'info').length, silenced: S.silenced.length },
    nodes: { ready: up.length, total: S.nodes.length },
    pods: S.pods.total ?? null,
    sites: S.sites ? { up: S.sites.filter(s => s.up).length, total: S.sites.length } : null,
    nas: S.nas ? { array: S.nas.array, disabled: S.nas.disabled, parity: !!S.nas.parity } : null,
  };
}

const tokenOk = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest(), b = crypto.createHash('sha256').update(TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
};

http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (code, body, cache = 'no-store') => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': cache });
    res.end(JSON.stringify(body));
  };
  // Always 200: when Prometheus is down the widget should get the "stale" face, not a 503
  if (path === '/healthz') return send(200, { polled: !!lastOk, error: lastErr || null });
  if (req.method !== 'GET') return send(405, { error: 'GET only' });
  // Polls run every 30 s regardless of traffic, so edge caching keeps public load off Prometheus
  if (path === '/public/status') return send(200, publicStatus(), 'public, max-age=30, s-maxage=30');
  if (path !== '/widget/status') return send(404, { error: 'not found' });
  if (!tokenOk(req)) return send(401, { error: 'unauthorized' });
  send(200, status());
}).listen(PORT, () => log(`listening on :${PORT}`));

poll().catch(e => log('poll:', e.message));
pollUptime().catch(e => log('uptime:', e.message));
setInterval(() => pollUptime().catch(e => log('uptime:', e.message)), UPTIME_MS);
setInterval(() => poll().catch(e => log('poll:', e.message)), POLL_MS);
process.on('SIGTERM', () => process.exit(0));
