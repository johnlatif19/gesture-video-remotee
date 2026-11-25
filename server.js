const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

function loadEnv() {
  const fs = require('fs');
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
try { loadEnv(); } catch (e) {}

const env = (k) => process.env[k] || '';
const JWT_SECRET = () => env('JWT_SECRET') || (process.env.NODE_ENV === 'test' ? 'test-secret' : '');
const CLD = () => ({
  cloud_name: env('CLOUDINRAY_NAME') || env('CLOUDINARY_NAME') || env('CLOUDINARY_CLOUD_NAME'),
  api_key: env('CLOUDINRAY_API_KEY') || env('CLOUDINARY_API_KEY'),
  api_secret: env('CLOUDINRAY_API_SECRET') || env('CLOUDINARY_API_SECRET'),
});

let db;
function getDb() {
  if (db) return db;
  if (env('FIREBASE_CONFIG')) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const cfg = JSON.parse(env('FIREBASE_CONFIG'));
      if (cfg.private_key) cfg.private_key = cfg.private_key.replace(/\\n/g, '\n');
      admin.initializeApp({ credential: admin.credential.cert(cfg) });
    }
    const fs = admin.firestore();
    db = {
      async get(col, id) { const d = await fs.collection(col).doc(id).get(); return d.exists ? d.data() : null; },
      async set(col, id, data) { await fs.collection(col).doc(id).set(data); },
      async del(col, id) { await fs.collection(col).doc(id).delete(); },
      async listBy(col, field, val) {
        const q = await fs.collection(col).where(field, '==', val).get();
        return q.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
    };
  } else {
    const mem = {};
    const c = (n) => (mem[n] = mem[n] || new Map());
    db = {
      async get(col, id) { const v = c(col).get(id); return v ? JSON.parse(JSON.stringify(v)) : null; },
      async set(col, id, data) { c(col).set(id, JSON.parse(JSON.stringify(data))); },
      async del(col, id) { c(col).delete(); },
      async listBy(col, field, val) { return [...c(col)].filter(([, v]) => v[field] === val).map(([id, v]) => ({ id, ...v })); },
    };
  }
  return db;
}
const _setDb = (d) => { db = d; };

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data: https://res.cloudinary.com; media-src 'self' https://res.cloudinary.com blob:; connect-src 'self' https://api.cloudinary.com https://storage.googleapis.com https://cdn.jsdelivr.net; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Cache-Control': req.path.startsWith('/api/') ? 'no-store' : 'no-cache',
  });
  next();
});

app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const o = req.headers.origin;
  if (o) {
    let h = '';
    try { h = new URL(o).host; } catch (e) {}
    if (h !== req.headers.host) return res.status(403).json({ error: 'origin' });
  }
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (process.env.NODE_ENV !== 'test') console.error(e.message);
  res.status(500).json({ error: 'خطأ في السيرفر' });
});
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rnd = (n) => crypto.randomBytes(n).toString('hex');
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);
const validUser = (u) => typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,30}$/.test(u);

function auth(req, res, next) {
  try {
    const t = req.cookies.token;
    req.user = jwt.verify(t, JWT_SECRET(), { algorithms: ['HS256'] }).u;
    next();
  } catch (e) { res.status(401).json({ error: 'سجل دخول الأول' }); }
}

const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.path + (req.headers['x-forwarded-for'] || req.ip);
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'محاولات كتير، استنى شوية' });
    arr.push(now); hits.set(k, arr); next();
  };
}

app.post('/api/signup', limit(10, 60000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!JWT_SECRET()) return res.status(500).json({ error: 'JWT_SECRET مش متضبط' });
  if (!validUser(username)) return res.status(400).json({ error: 'اليوزر 3-30 حرف إنجليزي/أرقام (_ . - مسموح)' });
  if (typeof password !== 'string' || password.length < 5 || password.length > 72) return res.status(400).json({ error: 'الباسورد من 5 لـ 72 حرف' });
  const id = sha(username.toLowerCase());
  if (await getDb().get('users', id)) return res.status(409).json({ error: 'اليوزر ده موجود' });
  await getDb().set('users', id, { username, hash: await bcrypt.hash(password, 10), created: Date.now() });
  res.json({ ok: true });
}));

app.post('/api/login', limit(10, 60000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!JWT_SECRET()) return res.status(500).json({ error: 'JWT_SECRET مش متضبط' });
  const id = validUser(username) ? sha(username.toLowerCase()) : '';
  const u = id && await getDb().get('users', id);
  const okPw = typeof password === 'string' && (await bcrypt.compare(password, u ? u.hash : DUMMY_HASH));
  if (!u || !okPw) return res.status(401).json({ error: 'يوزر أو باسورد غلط' });
  const token = jwt.sign({ u: id }, JWT_SECRET(), { algorithm: 'HS256', expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5, path: '/' });
  res.json({ ok: true, username: u.username });
}));

app.post('/api/logout', (req, res) => { res.clearCookie('token', { path: '/' }); res.json({ ok: true }); });

app.get('/api/me', auth, wrap(async (req, res) => {
  const u = await getDb().get('users', req.user);
  if (!u) return res.status(401).json({ error: 'سجل دخول الأول' });
  res.json({ username: u.username });
}));

let injectedCloud = null;
const _setCloud = (c) => { injectedCloud = c; };
function cloud() {
  if (injectedCloud) return injectedCloud;
  const cfg = CLD();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) return null;
  const c = require('cloudinary').v2;
  c.config({ ...cfg, secure: true });
  return {
    cloud_name: cfg.cloud_name, api_key: cfg.api_key,
    sign: (params) => c.utils.api_sign_request(params, cfg.api_secret),
    resource: async (public_id) => { try { return await c.api.resource(public_id, { resource_type: 'video' }); } catch (e) { return null; } },
    destroy: async (public_id) => c.uploader.destroy(public_id, { resource_type: 'video', invalidate: true }),
  };
}
const MAX_VIDEOS = 50;

app.post('/api/upload-signature', auth, wrap(async (req, res) => {
  const cl = cloud();
  if (!cl) return res.status(500).json({ error: 'بيانات Cloudinary مش متضبطة' });
  if ((await getDb().listBy('videos', 'owner', req.user)).length >= MAX_VIDEOS) return res.status(400).json({ error: 'وصلت للحد الأقصى للفيديوهات' });
  const timestamp = Math.round(Date.now() / 1000);
  const folder = 'gesture-remote/' + req.user;
  res.json({ timestamp, folder, signature: cl.sign({ timestamp, folder }), api_key: cl.api_key, cloud_name: cl.cloud_name });
}));

app.post('/api/videos', auth, wrap(async (req, res) => {
  const { public_id, title } = req.body || {};
  const prefix = 'gesture-remote/' + req.user + '/';
  if (typeof public_id !== 'string' || !public_id.startsWith(prefix) || public_id.includes('..') || public_id.length > 200)
    return res.status(400).json({ error: 'public_id غلط' });
  const cl = cloud();
  if (!cl) return res.status(500).json({ error: 'بيانات Cloudinary مش متضبطة' });
  const r = await cl.resource(public_id);
  if (!r || r.public_id !== public_id || typeof r.secure_url !== 'string' || !r.secure_url.startsWith('https://res.cloudinary.com/'))
    return res.status(400).json({ error: 'الفيديو مش موجود على Cloudinary' });
  const mine = await getDb().listBy('videos', 'owner', req.user);
  if (mine.some((v) => v.public_id === public_id)) return res.status(409).json({ error: 'متسجل قبل كده' });
  if (mine.length >= MAX_VIDEOS) return res.status(400).json({ error: 'وصلت للحد الأقصى للفيديوهات' });
  const id = rnd(8);
  await getDb().set('videos', id, { owner: req.user, public_id, url: r.secure_url, title: String(title || 'video').slice(0, 120), created: Date.now() });
  res.json({ ok: true, id });
}));

app.get('/api/videos', auth, wrap(async (req, res) => {
  const list = (await getDb().listBy('videos', 'owner', req.user)).sort((a, b) => b.created - a.created);
  res.json({ videos: list.map(({ id, title, url, created }) => ({ id, title, url, created })) });
}));

app.delete('/api/videos/:id', auth, wrap(async (req, res) => {
  const v = await getDb().get('videos', req.params.id);
  if (!v || v.owner !== req.user) return res.status(404).json({ error: 'مش موجود' });
  const cl = cloud();
  if (!cl) return res.status(500).json({ error: 'بيانات Cloudinary مش متضبطة' });
  try {
    const r = await cl.destroy(v.public_id);
    if (r && r.result && r.result !== 'ok' && r.result !== 'not found') throw new Error(r.result);
  } catch (e) { return res.status(502).json({ error: 'فشل المسح من Cloudinary' }); }
  await getDb().del('videos', req.params.id);
  res.json({ ok: true });
}));

const STALE_MS = 15000;
const UNPAIRED_TTL = 10 * 60000;
const PAIR_FAILS = 8, PAIR_WINDOW = 10 * 60000, PAIR_GLOBAL = 400;

async function failState(req) {
  const win = Math.floor(Date.now() / PAIR_WINDOW);
  const ipKey = 'ip-' + sha(String(req.ip)).slice(0, 24) + '-' + win, gKey = 'global-' + win;
  const [ip, g] = await Promise.all([getDb().get('limits', ipKey), getDb().get('limits', gKey)]);
  return { ipKey, gKey, ip: (ip && ip.n) || 0, g: (g && g.n) || 0 };
}
async function noteFail(f) {
  await getDb().set('limits', f.ipKey, { n: f.ip + 1 });
  await getDb().set('limits', f.gKey, { n: f.g + 1 });
}
const newCode = async () => {
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const s = await getDb().get('sessions', code);
    if (!s || Date.now() - s.seen > STALE_MS * 2) return code;
  }
  throw new Error('no code');
};

app.post('/api/session', auth, wrap(async (req, res) => {
  const old = req.body && req.body.oldCode;
  if (typeof old === 'string' && /^\d{6}$/.test(old)) {
    const o = await getDb().get('sessions', old);
    if (o && o.owner === req.user) await getDb().del('sessions', old);
  }
  const code = await newCode();
  const secret = rnd(16);
  await getDb().set('sessions', code, { owner: req.user, secretHash: sha(secret), camHash: '', seen: Date.now(), created: Date.now(), camSeen: 0, seq: 0, cmds: [] });
  res.json({ code, secret });
}));

app.post('/api/session/poll', wrap(async (req, res) => {
  const { code, secret, since } = req.body || {};
  const s = typeof code === 'string' && await getDb().get('sessions', code);
  if (!s || sha(String(secret)) !== s.secretHash) return res.status(410).json({ error: 'expired' });
  const now = Date.now();
  if (!s.camHash && now - s.created > UNPAIRED_TTL) { await getDb().del('sessions', code); return res.status(410).json({ error: 'expired' }); }
  const paired = !!s.camHash && now - s.camSeen < STALE_MS;
  if (s.camHash && !paired) { await getDb().del('sessions', code); return res.status(410).json({ error: 'camera-lost' }); }
  if (now - s.seen > 5000) { s.seen = now; await getDb().set('sessions', code, s); }
  res.json({ paired, cmds: s.cmds.filter((c) => c.seq > (Number(since) || 0)), seq: s.seq });
}));

app.post('/api/pair', wrap(async (req, res) => {
  const f = await failState(req);
  if (f.ip >= PAIR_FAILS || f.g >= PAIR_GLOBAL) return res.status(429).json({ error: 'محاولات كتير، جرب بعد شوية' });
  const { code } = req.body || {};
  const s = typeof code === 'string' && /^\d{6}$/.test(code) && await getDb().get('sessions', code);
  const live = s && Date.now() - s.seen <= STALE_MS * 2 && (s.camHash || Date.now() - s.created <= UNPAIRED_TTL);
  if (!live) { await noteFail(f); return res.status(404).json({ error: 'الكود غلط أو منتهي' }); }
  if (s.camHash) { await noteFail(f); return res.status(409).json({ error: 'الكود ده اتربط بكاميرا تانية' }); }
  const camToken = rnd(16);
  s.camHash = sha(camToken); s.camSeen = Date.now();
  await getDb().set('sessions', code, s);
  res.json({ ok: true, camToken });
}));

const TYPES = ['play', 'pause', 'back', 'forward', 'ping'];
app.post('/api/command', wrap(async (req, res) => {
  const { code, camToken, type } = req.body || {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'bad type' });
  const s = typeof code === 'string' && await getDb().get('sessions', code);
  if (!s || !s.camHash || sha(String(camToken)) !== s.camHash) return res.status(410).json({ error: 'expired' });
  if (Date.now() - s.seen > STALE_MS) return res.status(410).json({ error: 'expired' });
  s.camSeen = Date.now();
  if (type !== 'ping') { s.seq += 1; s.cmds = [...s.cmds, { seq: s.seq, type }].slice(-10); }
  await getDb().set('sessions', code, s);
  res.json({ ok: true });
}));

const pub = path.join(__dirname, 'public');
const guard = (req, res, next) => {
  try { jwt.verify(req.cookies.token, JWT_SECRET(), { algorithms: ['HS256'] }); next(); } catch (e) { res.redirect('/login'); }
};

app.get(['/dashboard', '/dashboard.html'], guard, (req, res) => res.sendFile(path.join(pub, 'dashboard.html')));
app.get(['/remote', '/remote.html'], guard, (req, res) => res.sendFile(path.join(pub, 'remote.html')));
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(pub, 'login.html')));
app.get(['/sign-in', '/sign-in.html'], (req, res) => res.sendFile(path.join(pub, 'sign-in.html')));
app.get(['/camera', '/camera.html'], (req, res) => res.sendFile(path.join(pub, 'camera.html')));
app.get('/', (req, res) => res.redirect('/login'));

app.use(express.static(pub, { extensions: [] }));

module.exports = app;
module.exports._setDb = _setDb;
module.exports._setCloud = _setCloud;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('http://localhost:' + port));
}
