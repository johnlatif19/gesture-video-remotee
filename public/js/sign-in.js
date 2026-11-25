const f = document.getElementById('f');
const err = document.getElementById('err');
const u = document.getElementById('u');
const p = document.getElementById('p');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  if (p.value.length < 5) {
    err.textContent = 'كلمة المرور 5 أحرف على الأقل';
    return;
  }
  try {
    const r = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u.value.trim(), password: p.value }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { location.href = '/login'; return; }
    err.textContent = d.error || 'حصلت مشكلة';
  } catch (e) {
    err.textContent = 'تعذر الاتصال بالسيرفر';
  }
});
