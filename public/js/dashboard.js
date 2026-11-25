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

const PART_CONCURRENCY = 4;

async function uploadMultipart(file, onProgress) {
  const init = await api('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: file.size, title: file.name }),
  });
  const { uploadId, key, partSize } = init;
  const totalParts = Math.ceil(file.size / partSize);
  const parts = [];
  let uploadedBytes = 0;
  let lastTime = performance.now();
  let lastLoaded = 0;
  let speed = 0;

  const queue = [];
  for (let i = 1; i <= totalParts; i++) queue.push(i);

  async function uploadOne(partNumber) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const { url } = await api('/api/upload/part-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key, partNumber }),
    });

    const res = await fetch(url, { method: 'PUT', body: blob });
    if (!res.ok) throw new Error('فشل رفع الجزء ' + partNumber);

    const etag = res.headers.get('ETag');
    parts.push({ ETag: etag, PartNumber: partNumber });

    uploadedBytes += blob.size;
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    if (dt >= 0.5) {
      const inst = (uploadedBytes - lastLoaded) / dt;
      speed = speed ? speed * 0.7 + inst * 0.3 : inst;
      lastLoaded = uploadedBytes;
      lastTime = now;
    }
    onProgress(uploadedBytes / file.size, uploadedBytes, file.size, speed);
  }

  async function worker() {
    while (queue.length) {
      const n = queue.shift();
      await uploadOne(n);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, totalParts) }, worker));
  parts.sort((a, b) => a.PartNumber - b.PartNumber);

  await api('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, key, parts }),
  });

  return { key };
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
    await uploadMultipart(file, (ratio, loaded, total, speed) => {
      const pct = ratio * 100;
      setRing(pct);
      const remainingBytes = total - loaded;
      if (speed > 0 && ratio < 1) {
        $('eta').textContent = 'المدة التقريبية: ' + fmtDuration(remainingBytes / speed);
      } else if (ratio >= 1) {
        $('eta').textContent = 'جارٍ الدمج…';
      } else {
        $('eta').textContent = 'المدة التقريبية: جارٍ الحساب…';
      }
      $('speed').textContent = speed > 0 ? 'سرعة الرفع: ' + fmtSpeed(speed) : '';
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
