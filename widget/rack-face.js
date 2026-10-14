// Rack Face widget for Scriptable (iOS). Shows the rack display's face and status.
// Data: GET https://rack.joe-cloud.com/widget/status (status/server.js) with a bearer token.
//
// Setup: paste this file into a new Scriptable script, run it once in the app and paste the
// widget token when asked (stored in the iOS Keychain). Then add a Scriptable widget to the
// Home Screen / StandBy / Lock Screen and pick this script. Run in the app with the parameter
// "reset" (or tap "Change token" in the menu) to replace the token.
// Sizes: small (face + status, also what StandBy shows), medium (face + details),
// lock screen circular (face) and rectangular (face + summary).

const URL_STATUS = 'https://rack.joe-cloud.com/widget/status';
const URL_OPEN = 'https://rack.joe-cloud.com/';
const KEY = 'rack-face-token';
const REFRESH_MIN = 5;   // a hint; iOS decides when widgets actually refresh

const SEV = { bad: '#ff4d6d', warn: '#ffb547', info: '#4de1ff' };
const GOOD = '#5ef2a0', DIM = '#73848e', FG = '#e6f1f6';

async function askToken() {
  const a = new Alert();
  a.title = 'Rack Face';
  a.message = 'Paste the widget token (kubectl -n rack-display get secret rack-display-widget-token).';
  a.addSecureTextField('token', Keychain.contains(KEY) ? Keychain.get(KEY) : '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if (await a.present() === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}

async function fetchStatus(token) {
  const r = new Request(URL_STATUS);
  r.headers = { Authorization: `Bearer ${token}` };
  r.timeoutInterval = 15;
  const body = await r.loadJSON();
  const code = r.response && r.response.statusCode;
  if (code !== 200) throw new Error(code === 401 ? 'token rejected' : `HTTP ${code}`);
  return body;
}

/* ---------------------------------- face ----------------------------------
   Same geometry as the page's draw() (web/index.html), minus glow and animation: eyes are
   rounded rects with the lids and the happy cut-out removed from the outline, so the
   face also works on a transparent background (Lock Screen, tinted/clear Home Screen).
   Page units: eyes at ±sep from centre, mouth 152 below; the box below fits all emotes. */
const FACE_W = 640, FACE_H = 380, FACE_CX = 320, FACE_CY = 150;

function drawFace(f, size, opts = {}) {
  const ctx = new DrawContext();
  ctx.size = new Size(size.w, size.h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  if (opts.bg !== false) { ctx.setFillColor(new Color('#000000')); ctx.fillRect(new Rect(0, 0, size.w, size.h)); }
  const k = Math.min(size.w / FACE_W, size.h / FACE_H);
  const ox = size.w / 2 - FACE_CX * k, oy = size.h / 2 - FACE_H / 2 * k + 10 * k;
  const P = (x, y) => new Point(ox + x * k, oy + y * k);
  const R = (x, y, w, h) => new Rect(ox + x * k, oy + y * k, w * k, h * k);
  const col = new Color(opts.mono ? '#ffffff' : f.col, f.dim ? .65 : 1);
  const cx = FACE_CX, cy = FACE_CY;

  for (const side of [-1, 1]) {
    const close = side < 0 ? f.closeL : f.closeR;
    // eyes ~15% smaller than the page's and the mouth bigger, so the face reads at widget size
    const ex = cx + side * f.sep * .74 + f.gx * 40, ey = cy + f.gy * 30;
    const fh = f.h * .85, w = f.w * .85, h = Math.max(12, fh * (1 - close * .93));
    const x0 = ex - w / 2, y0 = ey - h / 2 + (fh - h) * .2;

    if (f.x > .5) {   // crash: X eyes
      const s = 60, p = new Path();
      p.move(P(ex - s, ey - s)); p.addLine(P(ex + s, ey + s));
      p.move(P(ex + s, ey - s)); p.addLine(P(ex - s, ey + s));
      ctx.addPath(p); ctx.setStrokeColor(col); ctx.setLineWidth(30 * k); ctx.strokePath();
      continue;
    }
    // The eye is one filled outline: the rounded rect with the lids already cut away. Lids are
    // not painted black on top, because the Lock Screen and tinted/clear Home Screens render
    // widgets as one translucent tone, where black shows as grey blocks instead of nothing.
    const r = Math.min(f.r * .85, h / 2);
    // top lid: tilt > 0 = inner corner lower (angry), < 0 = outer lower (worried)
    const lidIn = y0 + (f.lid + f.tilt / 2) * h, lidOut = y0 + (f.lid - f.tilt / 2) * h;
    const yL = side < 0 ? lidOut : lidIn, yR = side < 0 ? lidIn : lidOut, slope = (yR - yL) / w;
    const hasLid = f.lid > .01 || Math.abs(f.tilt) > .01;
    // bottom lid: an ellipse rising from below makes the happy ^ ^ shape
    const hrx = w * .8, hry = h * .55, hcy = y0 + h - f.happy * h * .6 + hry;
    const corner = x => { const d = Math.max(0, r - Math.min(x - x0, x0 + w - x)); return r - Math.sqrt(Math.max(0, r * r - d * d)); };
    const top = [], bot = [];
    for (let i = 0; i <= 40; i++) {
      const x = x0 + w * i / 40, c = corner(x);
      let t = y0 + c, b = y0 + h - c;
      if (hasLid) t = Math.max(t, yL + slope * (x - x0));
      if (f.happy > .01) { const u = (x - ex) / hrx; if (Math.abs(u) < 1) b = Math.min(b, hcy - hry * Math.sqrt(1 - u * u)); }
      top.push([x, t]); bot.push([x, Math.max(t, b)]);
    }
    const eye = new Path();
    eye.addLines(top.concat(bot.reverse()).map(([x, y]) => P(x, y)));
    eye.closeSubpath();
    ctx.addPath(eye); ctx.setFillColor(col); ctx.fillPath();
  }

  const my = cy + 125;
  if (f.mW > 6) {
    const m = new Path();
    const mw = f.mW * 1.4;
    m.move(P(cx - mw / 2, my));
    m.addQuadCurve(P(cx + mw / 2, my), P(cx, my + f.mC * 46));
    ctx.addPath(m); ctx.setStrokeColor(col); ctx.setLineWidth(17 * k); ctx.strokePath();
  }
  if (f.mO > .03) {
    const rx = 12 + f.mO * 18, ry = 4 + f.mO * 24;
    ctx.setFillColor(col); ctx.fillEllipse(R(cx - rx, my + 4 - ry, rx * 2, ry * 2));
  }

  // small props
  ctx.setTextColor(col);
  if (f.bang) { ctx.setFont(Font.heavySystemFont(110 * k)); ctx.drawText('!', P(cx + 272, cy - 150)); }
  if (f.zzz) { ctx.setFont(Font.boldRoundedSystemFont(64 * k)); ctx.drawText('z', P(cx + 230, cy - 110)); ctx.setFont(Font.boldRoundedSystemFont(44 * k)); ctx.drawText('z', P(cx + 280, cy - 150)); }
  if (f.sweat) { ctx.setFillColor(opts.mono ? col : new Color('#7fd3ff')); ctx.fillEllipse(R(cx + 278, cy - 100, 26, 38)); }
  if (f.think) { ctx.setFillColor(col); [[238, -70, 16], [258, -108, 22], [282, -150, 30]].forEach(([x, y, d]) => ctx.fillEllipse(R(cx + x, cy + y, d, d))); }
  return ctx.getImage();
}

/* --------------------------------- widget -------------------------------- */
function headline(s) {
  if (!s) return { text: 'offline', color: DIM };
  if (s.stale) return { text: "can't reach Prometheus", color: DIM };
  if (s.lead) return { text: s.lead.label, color: SEV[s.lead.sev] || FG };
  return { text: s.night ? 'all quiet · zzz' : 'all good', color: GOOD };
}

function addText(stack, text, size, color, opts = {}) {
  const t = stack.addText(text);
  t.font = opts.bold ? Font.semiboldRoundedSystemFont(size) : Font.regularRoundedSystemFont(size);
  t.textColor = new Color(color);
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = .7;
  return t;
}

const STALE_FACE = { col: '#8b98a0', w: 190, h: 210, r: 58, sep: 205, lid: .3, tilt: -.18, happy: 0, closeL: 0, closeR: 0, x: 0,
  gx: 0, gy: .2, mW: 46, mC: -.25, mO: 0, bang: 0, zzz: 0, sweat: 0, think: 1, dim: 0 };

function build(s, err, family) {
  const fam = family || config.widgetFamily || 'medium';
  const face = s ? s.face : STALE_FACE;
  const head = headline(s);
  const w = new ListWidget();
  w.url = URL_OPEN;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60_000);

  if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const img = w.addImage(drawFace(face, { w: 120, h: 120 }, { mono: true, bg: false }));
    img.centerAlignImage();
    return w;
  }
  if (fam === 'accessoryRectangular') {
    const row = w.addStack();
    row.centerAlignContent();
    row.addImage(drawFace(face, { w: 240, h: 160 }, { mono: true, bg: false })).imageSize = new Size(60, 40);
    row.addSpacer(6);
    const col = row.addStack();
    col.layoutVertically();
    addText(col, s ? `${s.nodes.ready}/${s.nodes.total} nodes` : 'rack', 13, FG, { bold: true });
    addText(col, err ? err : head.text, 12, FG, { lines: 2 });
    return w;
  }
  if (fam === 'accessoryInline') {
    addText(w, s ? `rack · ${s.nodes.ready}/${s.nodes.total} nodes` : 'rack', 13, FG, { bold: true });
    addText(w, err ? err : head.text, 13, FG, { lines: 2 });
    return w;
  }

  w.backgroundColor = new Color('#000000');
  if (fam === 'small') {
    w.setPadding(10, 8, 10, 8);
    const img = w.addImage(drawFace(face, { w: 300, h: 180 }));
    img.centerAlignImage();
    w.addSpacer(4);
    const t = addText(w, err || head.text, 12, err ? DIM : head.color, { bold: true, lines: 2 });
    t.centerAlignText();
    return w;
  }

  // medium / large
  w.setPadding(12, 12, 12, 14);
  const row = w.addStack();
  row.centerAlignContent();
  row.addImage(drawFace(face, { w: 300, h: 180 })).imageSize = new Size(150, 90);
  row.addSpacer(10);
  const col = row.addStack();
  col.layoutVertically();
  addText(col, err || head.text, 14, err ? DIM : head.color, { bold: true, lines: 2 });
  col.addSpacer(4);
  if (s && !s.stale) {
    const more = s.events.length - 1;
    if (more > 0) addText(col, `+${more} more`, 11, DIM);
    addText(col, `${s.nodes.ready}/${s.nodes.total} nodes · ${s.pods ?? '—'} pods`, 11, FG);
    if (s.sites) addText(col, `${s.sites.up}/${s.sites.total} sites up`, 11, s.sites.up < s.sites.total ? SEV.bad : FG);
    if (s.nas) addText(col, `NAS ${s.nas.array.toLowerCase()}${s.nas.parity ? ' · parity check' : ''}${s.nas.disabled ? ` · ${s.nas.disabled} disk disabled` : ''}`, 11, FG);
  }
  col.addSpacer(2);
  if (s && s.updated) {
    const d = col.addDate(new Date(s.updated));
    d.applyRelativeStyle();
    d.font = Font.regularRoundedSystemFont(10);
    d.textColor = new Color(DIM);
  }
  return w;
}

/* ---------------------------------- main --------------------------------- */
let token = Keychain.contains(KEY) ? Keychain.get(KEY) : null;
if (config.runsInApp && (!token || args.queryParameters.reset !== undefined || args.widgetParameter === 'reset')) token = await askToken();

let status = null, err = null;
if (!token) err = 'run in Scriptable to set the token';
else {
  try { status = await fetchStatus(token); }
  catch (e) { err = e.message === 'token rejected' ? 'token rejected' : 'offline'; }
}

const widget = build(status, err);
if (config.runsInWidget) Script.setWidget(widget);
else {
  const a = new Alert();
  a.title = 'Rack Face';
  a.message = err ? `Error: ${err}` : `${status.emote} · ${headline(status).text}`;
  a.addAction('Preview small'); a.addAction('Preview medium'); a.addAction('Change token'); a.addCancelAction('Done');
  const i = await a.present();
  if (i === 0) await build(status, err, 'small').presentSmall();
  if (i === 1) await build(status, err, 'medium').presentMedium();
  if (i === 2) await askToken();
}
Script.complete();
