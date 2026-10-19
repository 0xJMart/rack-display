'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toPublic } = require('./public.js');

const S = {
  nodes: [
    { name: 'control-node', ready: true, cpu: 0.123, temp: 51.6, mem: .4, pods: 12, port: 2, poe: 5.1 },
    { name: 'node-2', ready: false, cpu: 0, temp: NaN, mem: 0, pods: 0 },
  ],
  pods: { total: 40, bad: [{ ns: 'secret-ns', name: 'vaultwarden-abc', reason: 'CrashLoopBackOff' }] },
  flux: { failed: ['apps-nextcloud'], reconciling: [] },
  sites: [{ host: 'nextcloud.joe-cloud.com', up: true, cert: 40 }, { host: 'keycloak.joe-cloud.com', up: false, cert: 3 }],
  alerts: [{ name: 'KubeDiskFull', detail: 'node-1' }], silenced: [], backup: {}, nas: { array: 'Started' },
};

test('only allowlisted keys, values sanitized', () => {
  const p = toPublic(S, { emote: 'crash', night: false, updated: '2026-10-19T00:00:00Z', stale: false });
  assert.deepStrictEqual(Object.keys(p).sort(), ['emote', 'fluxHealthy', 'label', 'night', 'nodes', 'podsHealthy', 'sitesUp', 'stale', 'updatedAt']);
  assert.deepStrictEqual(Object.keys(p.nodes[0]).sort(), ['cpu', 'name', 'ready', 'temp']);
  assert.deepStrictEqual(p.nodes, [{ name: 'control-node', ready: true, cpu: 12, temp: 52 }, { name: 'node-2', ready: false, cpu: 0, temp: null }]);
  assert.strictEqual(p.podsHealthy, false);
  assert.strictEqual(p.fluxHealthy, false);
  assert.strictEqual(p.sitesUp, '1/2');
  assert.strictEqual(p.label, 'a pod is crashlooping');
});

test('leaks nothing from the full state', () => {
  const json = JSON.stringify(toPublic(S, { emote: 'alarm', night: false, updated: null, stale: false }));
  for (const s of ['secret-ns', 'vaultwarden', 'nextcloud', 'keycloak', 'joe-cloud', 'KubeDiskFull', 'apps-', 'poe', 'mem', 'pods"']) {
    assert.ok(!json.includes(s), `leaked ${s}`);
  }
});

test('unknown emotes fall back to idle', () => {
  assert.strictEqual(toPublic(S, { emote: 'weird', night: false, updated: null, stale: false }).emote, 'idle');
});
