/* Rack face state: shared by the page (index.html, browser global RackState) and the widget
   status service (status/server.js, require). Pure functions only: callers do the fetching.

   queries      -> LQ (instant PromQL, polled every 15 s by the page, 30 s by the service)
   derive()     -> query results + Alertmanager alerts -> state (the page's S, minus history)
   events(S)    -> prioritised list of things the face reacts to
   emoteFor()   -> which emote the top event shows (night: sleep unless something is wrong)
   EMO / BASE   -> face parameters per emote (the page eases between them; the widget draws them) */
(function (root) {
'use strict';

/* ----------------------------- live queries ------------------------------
   Any source that returns nothing (exporter missing or down) leaves its part
   of the state null instead of failing. */
const NODE_JOIN = q => `(${q}) * on(instance) group_left(nodename) node_uname_info{job="node-exporter"}`;
const LQ = {
  ready:      'kube_node_status_condition{condition="Ready",status="true"}',
  cpu:        NODE_JOIN('1 - avg by (instance) (rate(node_cpu_seconds_total{job="node-exporter",mode="idle"}[2m]))'),
  temp:       NODE_JOIN('max by (instance) (node_thermal_zone_temp{job="node-exporter",type="cpu-thermal"})'),
  mem:        NODE_JOIN('1 - node_memory_MemAvailable_bytes{job="node-exporter"} / node_memory_MemTotal_bytes{job="node-exporter"}'),
  pods:       'sum by (node) (kube_pod_info * on(namespace, pod) group_left() (kube_pod_status_phase{phase="Running"} == 1))',
  bad:        'kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|InvalidImageName"} == 1',
  bkActive:   'kube_cronjob_status_active{namespace="backup"}',
  bkOkAge:    'time() - kube_cronjob_status_last_successful_time{namespace="backup"}',
  bkSchedAge: 'time() - kube_cronjob_status_last_schedule_time{namespace="backup"}',
  nasStarted: 'unraid_array_started',
  nasParity:  'unraid_parity_check_running',
  nasDisabled:'unraid_array_disks_disabled',
  nasDisks:   'count(unraid_disk_ok)',
  nasRx:      'rate(node_network_receive_bytes_total{instance="tower",device="bond0"}[2m])',
  nasTx:      'rate(node_network_transmit_bytes_total{instance="tower",device="bond0"}[2m])',
  alerts:     'ALERTS{alertstate="firing",severity=~"critical|warning"}',   // fallback when Alertmanager is unreachable
  sites:      'probe_success{job=~"probe/.*/sites"}',                          // blackbox exporter
  siteCert:   '(probe_ssl_earliest_cert_expiry{job=~"probe/.*/sites"} - time()) / 86400',
  certs:      '(certmanager_certificate_expiration_timestamp_seconds - time()) / 86400',
  flux:       'gotk_resource_info{customresource_kind=~"Kustomization|HelmRelease"}',  // kube-state-metrics custom resource state
  poe:        'unpoller_device_port_poe_watts',
  poeClients: 'unpoller_client_uptime_seconds{wired="true"}',                  // gives each Pi's switch port
  tUp:        'transmission_up',
  tDown:      'transmission_download_speed_bytes',
  tUpRate:    'transmission_upload_speed_bytes',
  tTorrents:  'transmission_torrents',
  tSize:      'transmission_downloading_size_bytes',
  tLeft:      'transmission_downloading_left_bytes',
};
// Alerts the face already shows through its own events (silencing them still mutes those events).
const COVERED_ALERTS = new Set(['Watchdog', 'KubePodCrashLooping', 'KubeNodeNotReady', 'KubeNodeUnreachable', 'KubeJobFailed', 'HomelabBackupFailed']);

const val = x => +x.value[1];
const by = (rows, label) => Object.fromEntries((rows || []).map(x => [x.metric[label], val(x)]));
const humanize = name => name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z\d])([A-Z])/g, '$1 $2');

/* R: { [LQ key]: Prometheus result rows | null }
   am: [{ labels, suppressed }] from Alertmanager, or null to fall back to R.alerts (no silences)
   fluxBefore: { failed: Set, busy: Set } from the previous call
   Returns { state, fluxBefore }. state.nodes has no history arrays; the page adds its own. */
function derive(R, am, fluxBefore) {
  const S = {};
  const ready = by(R.ready, 'node'), cpu = by(R.cpu, 'nodename'), temp = by(R.temp, 'nodename');
  const mem = by(R.mem, 'nodename'), pods = by(R.pods, 'node');
  const names = Object.keys(ready).sort((a, b) => (a === 'control-node' ? -1 : b === 'control-node' ? 1 : a.localeCompare(b)));
  S.nodes = names.map(name => ({ name, port: null, poe: null,
    ready: ready[name] === 1, cpu: cpu[name] ?? 0, temp: temp[name] ?? NaN, mem: mem[name] ?? 0, pods: pods[name] ?? 0 }));
  S.pods = {
    total: Object.values(pods).reduce((a, b) => a + b, 0),
    bad: (R.bad || []).map(x => ({ ns: x.metric.namespace, name: x.metric.pod, reason: x.metric.reason })),
  };

  // A CronJob that was scheduled after its last success and isn't running any more has failed.
  const active = by(R.bkActive, 'cronjob'), okAge = by(R.bkOkAge, 'cronjob'), schedAge = by(R.bkSchedAge, 'cronjob');
  const jobs = {};
  let running = null, failedJob = null;
  for (const name of Object.keys({ ...active, ...okAge, ...schedAge }).sort()) {
    const isActive = active[name] > 0;
    const failed = !isActive && schedAge[name] > 120 && (okAge[name] == null || schedAge[name] < okAge[name]);
    jobs[name] = { age: (okAge[name] ?? NaN) / 3600, ok: !failed };
    if (isActive && !running) running = { job: name, what: `started ${Math.max(1, Math.round((schedAge[name] || 0) / 60))}m ago`, pct: null };
    if (failed && !failedJob) failedJob = name;
  }
  S.backup = { jobs, running, failed: failedJob };

  const arr = R.nasStarted?.[0];
  S.nas = arr ? {
    array: val(arr) === 1 && (arr.metric.state || 'STARTED') === 'STARTED' ? 'Started' : 'Stopped',
    disks: R.nasDisks?.[0] ? val(R.nasDisks[0]) : null,
    disabled: R.nasDisabled?.[0] ? val(R.nasDisabled[0]) : 0,
    parity: R.nasParity?.[0] && val(R.nasParity[0]) === 1 ? { pct: null } : null,
  } : null;
  // blackbox: one series per probed URL
  const siteCert = by(R.siteCert, 'instance');
  S.sites = R.sites?.length ? R.sites.map(x => ({
    host: new URL(x.metric.instance).host, up: val(x) === 1,
    cert: siteCert[x.metric.instance] != null ? Math.floor(siteCert[x.metric.instance]) : null,
  })).sort((a, b) => a.host.localeCompare(b.host)) : null;
  // The cert's own namespace is exported_namespace; namespace is cert-manager's (the scrape target).
  S.certs = R.certs?.length ? R.certs.map(x => ({ name: `${x.metric.exported_namespace || x.metric.namespace}/${x.metric.name}`, days: Math.floor(val(x)) })) : null;

  // Flux: every new commit briefly marks dependents Ready=False/DependencyNotReady and objects
  // Unknown while they reconcile. Treat DependencyNotReady as waiting, and only count a state
  // that is still there on the next poll, so routine reconciles don't make the face flicker.
  if (R.flux?.length) {
    const items = R.flux.filter(x => x.metric.suspended !== 'true')
      .map(x => ({ name: x.metric.name, ready: x.metric.ready, reason: x.metric.reason }));
    const failedNow = items.filter(i => i.ready === 'False' && i.reason !== 'DependencyNotReady').map(i => i.name);
    const busyNow = items.filter(i => i.ready === 'Unknown' || i.reason === 'DependencyNotReady').map(i => i.name);
    S.flux = { total: items.length,
      failed: failedNow.filter(n => fluxBefore.failed.has(n)),
      reconciling: busyNow.filter(n => fluxBefore.busy.has(n)) };
    fluxBefore = { failed: new Set(failedNow), busy: new Set(busyNow) };
  } else S.flux = null;

  // unpoller: PoE watts per switch port, and which port each node is on (UniFi client name = hostname)
  if (R.poe?.length) {
    const watts = by(R.poe, 'port_num');
    const portOf = by((R.poeClients || []).map(x => ({ metric: x.metric, value: [0, x.metric.sw_port] })), 'name');
    S.poe = { total: Object.values(watts).reduce((a, b) => a + b, 0), ports: Object.keys(watts).length };
    S.nodes.forEach(n => { n.port = portOf[n.name] || null; n.poe = n.port != null ? watts[n.port] ?? 0 : null; });
  } else S.poe = null;

  // transmission exporter
  if (R.tUp?.[0] && val(R.tUp[0]) === 1) {
    const counts = by(R.tTorrents, 'status'), size = R.tSize?.[0] ? val(R.tSize[0]) : 0, left = R.tLeft?.[0] ? val(R.tLeft[0]) : 0;
    S.torrents = { active: (counts.downloading || 0) + (counts.download_wait || 0), seeding: counts.seeding || 0,
      down: (R.tDown?.[0] ? val(R.tDown[0]) : 0) / 1e6, up: (R.tUpRate?.[0] ? val(R.tUpRate[0]) : 0) / 1e6,
      pct: size ? (size - left) / size * 100 : 0 };
  } else S.torrents = null;

  S.nfs = R.nasRx?.[0] && R.nasTx?.[0] ? { rx: val(R.nasRx[0]) / 1e6, tx: val(R.nasTx[0]) / 1e6 } : null;

  let alerts = am || (R.alerts || []).map(a => ({ labels: a.metric, suppressed: false }));
  alerts = alerts.filter(a => /^(critical|warning)$/.test(a.labels.severity || ''));
  S.silenced = alerts.filter(a => a.suppressed).map(a => a.labels);
  S.alerts = alerts.filter(a => !a.suppressed && !COVERED_ALERTS.has(a.labels.alertname)).map(({ labels: l }) => ({
    name: humanize(l.alertname), sev: l.severity,
    detail: l.disk || l.device || l.namespace || l.instance || '',
  }));
  return { state: S, fluxBefore };
}

/* -------------------------- events → emote ----------------------------- */
// True if an alert with this name and these labels is silenced/inhibited in Alertmanager.
const silenced = (S, name, match) => S.silenced.some(l => l.alertname === name && Object.entries(match).every(([k, v]) => l[k] === v));

function events(S) {
  const ev = [];
  if (S.stale) ev.push({ id: 'stale', prio: 99, sev: 'bad', label: "can't reach Prometheus" });
  S.pods.bad.filter(p => !silenced(S, 'KubePodCrashLooping', { namespace: p.ns, pod: p.name })).forEach(p => ev.push({ id: 'crash', prio: 100, sev: 'bad', label: `${p.ns}/${p.name} · ${p.reason}` }));
  S.nodes.filter(n => !n.ready && !silenced(S, 'KubeNodeNotReady', { node: n.name }) && !silenced(S, 'KubeNodeUnreachable', { node: n.name })).forEach(n => ev.push({ id: 'nodeDown', prio: 95, sev: 'bad', label: `${n.name} is NotReady` }));
  S.sites?.filter(s => !s.up).forEach(s => ev.push({ id: 'alarm', prio: 90, sev: 'bad', label: `${s.host} is down` }));
  S.alerts.forEach(a => ev.push({ id: 'alarm', prio: a.sev === 'critical' ? 88 : 70, sev: a.sev === 'critical' ? 'bad' : 'warn',
    label: a.name + (a.detail ? ` · ${a.detail}` : '') }));
  if (S.certs) S.certs.filter(c => c.days <= 7).forEach(c => ev.push({ id: 'alarm', prio: 85, sev: 'warn', label: `${c.name} cert expires in ${c.days} days` }));
  else S.sites?.filter(s => s.up && s.cert != null && s.cert <= 7).forEach(s => ev.push({ id: 'alarm', prio: 85, sev: 'warn', label: `${s.host} cert expires in ${s.cert} days` }));
  const bkMuted = S.silenced.some(l => l.alertname === 'HomelabBackupFailed' && (l.job_name || '').startsWith(S.backup.failed + '-'));
  if (S.backup.failed && !bkMuted) ev.push({ id: 'backupFail', prio: 80, sev: 'warn', label: `${S.backup.failed}: last run failed` });
  S.flux?.failed.forEach(k => ev.push({ id: 'fluxFail', prio: 75, sev: 'warn', label: `flux: kustomization ${k} not ready` }));
  const up = S.nodes.filter(n => n.ready && !Number.isNaN(n.temp));
  const hot = up.reduce((a, b) => (!a || b.temp > a.temp ? b : a), null);
  if (hot && hot.temp >= 75) ev.push({ id: 'hot', prio: 60, sev: 'warn', label: `${hot.name} is at ${hot.temp.toFixed(0)}°C` });
  const avg = up.reduce((a, n) => a + n.cpu, 0) / Math.max(1, up.length);
  if (avg > .7 || up.some(n => n.cpu > .92)) ev.push({ id: 'cpu', prio: 55, sev: 'warn', label: `cluster CPU ${Math.round(avg * 100)}%` });
  const par = S.nas?.parity;
  if (par) ev.push({ id: 'parity', prio: 40, sev: 'info', label: par.pct != null ? `NAS parity check ${par.pct.toFixed(1)}%` : 'NAS parity check running',
    progress: par.pct != null ? par.pct / 100 : null });
  if (S.backup.running) {
    const r = S.backup.running;
    ev.push({ id: 'backup', prio: 35, sev: 'info', label: `${r.job} · ${r.what}`, progress: r.pct != null ? r.pct / 100 : null });
  }
  S.flux?.reconciling.forEach(k => ev.push({ id: 'fluxRec', prio: 30, sev: 'info', label: `flux reconciling ${k}…` }));
  if (S.torrents?.active) ev.push({ id: 'torrent', prio: 20, sev: 'info',
    label: `${S.torrents.active} torrents · ↓ ${S.torrents.down.toFixed(1)} MB/s · ↑ ${S.torrents.up.toFixed(1)} MB/s`, progress: S.torrents.pct / 100 });
  return ev.sort((a, b) => b.prio - a.prio);
}

// The face sleeps at night unless the top event is a warning or worse.
function emoteFor(evs, night) {
  const lead = evs[0] || null;
  if (night && (!lead || lead.sev === 'info')) return 'sleep';
  return lead ? lead.id : 'idle';
}

/* Face parameters. Every number is eased toward the active emote's values,
   so any emote can blend into any other. */
const BASE = { w: 190, h: 210, r: 58, sep: 205, lid: 0, tilt: 0, happy: 0, closeL: 0, closeR: 0, x: 0, gx: 0, gy: 0,
  mW: 0, mC: 0, mO: 0, jit: 0, sweat: 0, blush: 0, zzz: 0, box: 0, arrows: 0, stars: 0, think: 0, bang: 0, glasses: 0, dim: 0, prog: 0 };
const EMO = {
  idle:       { col: '#4de1ff', mW: 54, mC: .35 },
  tap:        { col: '#ff8fd0', happy: .75, mW: 120, mC: 1, h: 200 },
  sleep:      { col: '#4a7dff', closeL: 1, closeR: 1, zzz: 1, gx: 0, gy: .3, dim: 1 },
  backup:     { col: '#5ef2a0', lid: .26, gx: .4, gy: .4, box: 1, mW: 36, mC: .1, prog: 1 },
  torrent:    { col: '#b48cff', lid: .12, gx: 0, gy: .6, arrows: 1, mW: 30, mC: .3, h: 200, prog: 1 },
  fluxRec:    { col: '#4de1ff', gx: .5, gy: -.6, think: 1, mW: 34, mC: 0 },
  parity:     { col: '#38d9c4', lid: .28, gx: 0, gy: .35, glasses: 1, mW: 36, mC: .1, prog: 1 },
  cpu:        { col: '#ff9a3d', lid: .3, tilt: .2, jit: 1, sweat: 1, mW: 92, mC: -.1 },
  hot:        { col: '#ff7a59', lid: .42, tilt: -.1, blush: 1, mO: .55 },
  backupFail: { col: '#ffb547', lid: .16, tilt: -.34, sweat: 1, mW: 70, mC: -.6 },
  fluxFail:   { col: '#ffb547', lid: .46, tilt: .36, mW: 80, mC: -.15 },
  alarm:      { col: '#ff4d6d', w: 172, h: 250, bang: 1, mO: 1 },
  nodeDown:   { col: '#ff8a4d', closeR: 1, lid: .1, tilt: -.16, mW: 70, mC: -.45 },
  crash:      { col: '#ff4d6d', x: 1, stars: 1, mO: .8 },
  stale:      { col: '#8b98a0', lid: .3, tilt: -.18, gx: 0, gy: .2, think: 1, mW: 46, mC: -.25 },
};
// While asleep, the top info event still shows faintly ("dreaming" about it).
const DREAM = { backup: 'box', torrent: 'arrows', parity: 'glasses', fluxRec: 'think' };

const api = { LQ, COVERED_ALERTS, val, by, humanize, derive, silenced, events, emoteFor, BASE, EMO, DREAM };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.RackState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
