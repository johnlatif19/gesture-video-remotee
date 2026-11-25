const $ = (id) => document.getElementById(id);
const err = $('err'), list = $('list');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, opt) {
  const r = await fetch(url, opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'خطأ');
  return d;
}
async function load() {
  const me = await api('/api/me'); $('hi').textContent = 'أهلا ' + me.username;
  const { videos } = await api('/api/videos');
  list.innerHTML = videos.length ? '' : '<p class="muted">لسه مفيش فيديوهات.</p>';
  videos.forEach((v) => {
    const d = document.createElement('div'); d.className = 'vid';
    d.innerHTML = `<video src="${esc(v.url)}" preload="metadata" muted></video><div class="t">${esc(v.title)}</div><button class="danger">مسح</button>`;
    d.querySelector('button').onclick = async () => {
      if (!confirm('تمسح الفيديو ده؟')) return;
      try { await api('/api/videos/' + v.id, { method: 'DELETE' }); load(); } catch (e) { err.textContent = e.message; }
    };
    list.appendChild(d);
  });
}
$('up').onclick = async () => {
  err.textContent = '';
  const file = $('file').files[0];
  if (!file) { err.textContent = 'اختار فيديو الأول'; return; }
  try {
    const s = await api('/api/upload-signature', { method: 'POST' });
    const fd = new FormData();
    fd.append('file', file); fd.append('api_key', s.api_key); fd.append('timestamp', s.timestamp);
    fd.append('folder', s.folder); fd.append('signature', s.signature);
    $('prog').hidden = false; $('prog').value = 0;
    const res = await new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open('POST', `https://api.cloudinary.com/v1_1/${s.cloud_name}/video/upload`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) $('prog').value = (e.loaded / e.total) * 100; };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} x.status < 300 ? ok(j) : no(new Error((j.error && j.error.message) || 'فشل الرفع')); };
      x.onerror = () => no(new Error('فشل الاتصال')); x.send(fd);
    });
    await api('/api/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_id: res.public_id, url: res.secure_url, title: file.name }) });
    $('file').value = ''; load();
  } catch (e) { err.textContent = e.message; }
  $('prog').hidden = true;
};
$('out').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; };
load();
