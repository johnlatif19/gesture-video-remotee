const f = document.getElementById('f'), err = document.getElementById('err');
f.addEventListener('submit', async (e) => {
  e.preventDefault(); err.textContent = '';
  const r = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u.value.trim(), password: p.value }) });
  const d = await r.json().catch(() => ({}));
  if (r.ok) location.href = '/login'; else err.textContent = d.error || 'حصلت مشكلة';
});
