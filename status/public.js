// Public, unauthenticated cluster summary for joe-martinez.com (the resume site's 3D rack).
// Allowlist only: no hostnames, IPs, namespaces, pod/app/alert/cert names. Labels are fixed strings per emote.
'use strict';

const LABELS = {
  idle: 'all good', tap: 'all good', sleep: 'asleep',
  crash: 'a pod is crashlooping', nodeDown: 'a node is down', alarm: 'an alert is firing', stale: "can't reach Prometheus",
  backupFail: 'a backup failed', fluxFail: 'a GitOps sync failed', hot: 'a Pi is running hot', cpu: 'cluster is busy',
  parity: 'NAS parity check', backup: 'backup running', fluxRec: 'GitOps reconciling', torrent: 'downloading',
};

function toPublic(S, { emote, night, updated, stale }) {
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
  };
}

module.exports = { toPublic, LABELS };
