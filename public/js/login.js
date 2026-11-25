const f = document.getElementById('f');
const err = document.getElementById('err');
const u = document.getElementById('u');
const p = document.getElementById('p');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u.value.trim(), password: p.value }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { location.href = '/dashboard'; return; }
    err.textContent = d.error || 'حصلت مشكلة';
  } catch (e) {
    err.textContent = 'تعذر الاتصال بالسيرفر';
  }
});
