const $ = (id) => document.getElementById(id);
const v = $('v');
let code = null, secret = null, since = 0, fails = 0, running = false;

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function newSession() {
  const r = await post('/api/session', { oldCode: code });
  if (r.status === 401) { location.href = '/login'; return false; }
  if (!r.ok) return false;
  const d = await r.json();
  code = d.code;
  secret = d.secret;
  since = 0;
  fails = 0;
  $('code').textContent = code;
  setStatus(false);
  return true;
}

function setStatus(paired) {
  $('status').textContent = paired ? 'الكاميرا متصلة' : 'بانتظار الكاميرا';
  $('status').className = paired ? 'on' : 'off';
}

function toast(t) {
  const e = $('toast');
  e.textContent = t;
  e.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.classList.remove('show'), 900);
}

function run(type) {
  if (!v.src) { toast('اختر فيديو'); return; }
  if (type === 'play') {
    v.play().catch(() => { $('hint').textContent = 'المتصفح منع التشغيل التلقائي، اضغط على الفيديو مرة واحدة.'; });
    toast('تشغيل');
  }
  if (type === 'pause') { v.pause(); toast('إيقاف'); }
  if (type === 'back') { v.currentTime = Math.max(0, v.currentTime - 5); toast('رجوع 5'); }
  if (type === 'forward') { v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 5); toast('تقديم 5'); }
}

async function loop() {
  if (running) return;
  running = true;
  while (true) {
    try {
      if (!code && !(await newSession())) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      const r = await post('/api/session/poll', { code, secret, since });
      if (r.status === 410) { await newSession(); continue; }
      if (!r.ok) throw new Error('poll');
      fails = 0;
      const d = await r.json();
      setStatus(d.paired);
      d.cmds.forEach((c) => { since = Math.max(since, c.seq); run(c.type); });
    } catch (e) {
      fails++;
      if (fails >= 5) { code = null; secret = null; $('code').textContent = '------'; }
    }
    await new Promise((r) => setTimeout(r, 900));
  }
}

async function videos() {
  const r = await fetch('/api/videos');
  if (r.status === 401) { location.href = '/login'; return; }
  const { videos } = await r.json();
  const l = $('list');
  l.innerHTML = videos.length ? '' : '<p class="muted">لا توجد فيديوهات. ارفع من لوحة التحكم.</p>';
  videos.forEach((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item';
    b.textContent = x.title;
    b.onclick = () => {
      v.src = x.url;
      v.play().then(() => { $('hint').textContent = 'التحكم بالإيد شغال.'; })
             .catch(() => { $('hint').textContent = 'اضغط تشغيل على الفيديو مرة واحدة للسماح بالتحكم.'; });
      document.querySelectorAll('.item').forEach((i) => i.classList.remove('active'));
      b.classList.add('active');
    };
    l.appendChild(b);
  });
}

videos();
loop();
