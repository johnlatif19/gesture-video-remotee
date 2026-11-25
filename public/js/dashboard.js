const $ = (id) => document.getElementById(id);
const err = $('err');
const list = $('list');
const RING_LEN = 326.73;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opt) {
  const r = await fetch(url, opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'خطأ');
  return d;
}

function setRing(pct) {
  const p = Math.max(0, Math.min(100, pct));
  $('pct').textContent = Math.round(p) + '%';
  $('ringFg').style.strokeDashoffset = String(RING_LEN - (RING_LEN * p) / 100);
}

function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return 'أقل من ثانية';
  if (sec < 60) return Math.ceil(sec) + ' ث';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return m + ' د ' + (s ? s + ' ث' : '');
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h + ' س ' + (mm ? mm + ' د' : '');
}

function fmtSpeed(bps) {
  if (!isFinite(bps) || bps <= 0) return '';
  if (bps >= 1048576) return (bps / 1048576).toFixed(2) + ' ميجا/ث';
  if (bps >= 1024) return (bps / 1024).toFixed(0) + ' كيلو/ث';
  return bps.toFixed(0) + ' بايت/ث';
}

async function load() {
  const me = await api('/api/me');
  $('hi').textContent = 'مرحباً ' + me.username;
  const { videos } = await api('/api/videos');
  list.innerHTML = videos.length ? '' : '<p class="muted">لا توجد فيديوهات بعد.</p>';
  videos.forEach((v) => {
    const d = document.createElement('div');
    d.className = 'vid';
    d.innerHTML = `<video src="${esc(v.url)}" preload="metadata" muted></video><div class="t">${esc(v.title)}</div><button class="danger" type="button">مسح</button>`;
    d.querySelector('button').onclick = async () => {
      if (!confirm('مسح الفيديو؟')) return;
      try { await api('/api/videos/' + v.id, { method: 'DELETE' }); load(); } catch (e) { err.textContent = e.message; }
    };
    list.appendChild(d);
  });
}

function uploadCloudinary(s, file, onProgress) {
  return new Promise((ok, no) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('api_key', s.api_key);
    fd.append('timestamp', s.timestamp);
    fd.append('folder', s.folder);
    fd.append('signature', s.signature);

    const x = new XMLHttpRequest();
    x.open('POST', `https://api.cloudinary.com/v1_1/${s.cloud_name}/video/upload`);

    const total = file.size;
    let lastLoaded = 0;
    let lastTime = performance.now();
    let speed = 0;
    let startedAt = 0;

    x.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const now = performance.now();
      if (!startedAt) startedAt = now;
      const dt = (now - lastTime) / 1000;
      if (dt >= 0.35) {
        const dBytes = e.loaded - lastLoaded;
        if (dBytes > 0) {
          const inst = dBytes / dt;
          speed = speed ? speed * 0.7 + inst * 0.3 : inst;
        }
        lastLoaded = e.loaded;
        lastTime = now;
      }
      const ratio = total ? e.loaded / total : 0;
      onProgress(ratio, e.loaded, total, speed);
    };

    x.onload = () => {
      let j = {};
      try { j = JSON.parse(x.responseText); } catch (e) {}
      if (x.status < 300) ok(j);
      else no(new Error((j.error && j.error.message) || 'فشل الرفع'));
    };
    x.onerror = () => no(new Error('فشل الاتصال'));
    x.send(fd);
  });
}

$('up').onclick = async () => {
  err.textContent = '';
  const file = $('file').files[0];
  if (!file) { err.textContent = 'اختر فيديو أولاً'; return; }

  $('up').disabled = true;
  $('progWrap').hidden = false;
  setRing(0);
  $('eta').textContent = 'جارٍ الحساب…';
  $('speed').textContent = '';

  try {
    const s = await api('/api/upload-signature', { method: 'POST' });
    const res = await uploadCloudinary(s, file, (ratio, loaded, total, speed) => {
      const pct = ratio * 100;
      setRing(pct);
      const remainingBytes = total - loaded;
      if (speed > 0 && ratio < 1) {
        const eta = remainingBytes / speed;
        $('eta').textContent = 'المدة التقريبية: ' + fmtDuration(eta);
      } else if (ratio >= 1) {
        $('eta').textContent = 'جارٍ الحفظ…';
      } else {
        $('eta').textContent = 'المدة التقريبية: جارٍ الحساب…';
      }
      $('speed').textContent = speed > 0 ? 'سرعة الرفع: ' + fmtSpeed(speed) : '';
    });

    await api('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: res.public_id, url: res.secure_url, title: file.name }),
    });

    $('file').value = '';
    setRing(100);
    $('eta').textContent = 'تم الرفع';
    setTimeout(() => { $('progWrap').hidden = true; setRing(0); }, 800);
    load();
  } catch (e) {
    err.textContent = e.message;
    $('progWrap').hidden = true;
    setRing(0);
  } finally {
    $('up').disabled = false;
  }
};

$('out').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
};

load().catch((e) => { err.textContent = e.message; });
