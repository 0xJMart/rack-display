// Public, unauthenticated cluster summary for joe-martinez.com (the resume site's 3D rack).
// Allowlist only: no hostnames, IPs, namespaces, pod/app/alert/cert names. Labels are fixed strings per emote.
'use strict';

const LABELS = {
  idle: 'all good', tap: 'all good', sleep: 'asleep',
  crash: 'a pod is crashlooping', nodeDown: 'a node is down', alarm: 'an alert is firing', stale: "can't reach Prometheus",
  backupFail: 'a backup failed', fluxFail: 'a GitOps sync failed', hot: 'a Pi is running hot', cpu: 'cluster is busy',
  parity: 'NAS parity check', backup: 'backup running', fluxRec: 'GitOps reconciling', torrent: 'downloading',
};

// Uptime of the public site from its blackbox probe. Missing samples count as down: the probe runs
// in the cluster, so a cluster outage shows up as a gap, not as failed probes.
//   ok       successful probes in the window (sum_over_time of probe_success)
//   samples  probes that did run (count_over_time)
//   first    unix seconds of the earliest probe in the window
function uptimeFrom({ ok, samples, first }, now, intervalS) {
  if (!(samples > 0) || !Number.isFinite(first)) return null;
  const expected = Math.max(samples, Math.floor((now - first) / intervalS) + 1);
  const pct = Math.floor((ok / expected) * 10000) / 100; // floor: never round 99.996 up to 100
  return { pct: Math.min(100, pct), hours: Math.round(((now - first) / 3600) * 10) / 10 };
}

function toPublic(S, { emote, night, updated, stale, uptime = null }) {
  return {
    updatedAt: updated,
    stale,
    night,
    emote: LABELS[emote] ? emote : 'idle',
    label: LABELS[emote] || 'all good',
    nodes: S.nodes.map(n => ({
      name: n.name,
      ready: !!n.ready,
      cpu: Math.round((n.cpu || 0) * 100),
      temp: Number.isFinite(n.temp) ? Math.round(n.temp) : null,
    })),
    podsHealthy: S.pods.bad.length === 0,
    fluxHealthy: !(S.flux?.failed?.length),
    sitesUp: S.sites ? `${S.sites.filter(s => s.up).length}/${S.sites.length}` : null,
    uptime: uptime && { pct: uptime.pct, hours: uptime.hours, windowDays: uptime.windowDays },
  };
}

module.exports = { toPublic, uptimeFrom, LABELS };
