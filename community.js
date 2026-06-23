(function () {
  const fb = window.inkboundFirebase || {};
  const auth = fb.auth;
  const db = fb.db;

  const form = document.getElementById('communityForm');
  const input = document.getElementById('communityInput');
  const list = document.getElementById('communityMessages');

  if (!form || !input || !list || !db || !auth) return;

  function renderMessage(doc) {
    const data = doc.data();
    const card = document.createElement('div');
    card.className = 'community-message';
    const when = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date();
    card.innerHTML = `
      <div class="meta">
        <strong>${escapeHtml(data.displayName || data.email || 'User')}</strong>
        <span>${when.toLocaleString()}</span>
      </div>
      <div class="text">${escapeHtml(data.text || '')}</div>
    `;
    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  const query = db.collection('communityMessages').orderBy('createdAt', 'desc').limit(30);
  query.onSnapshot((snap) => {
    const items = [];
    snap.forEach((doc) => items.push(renderMessage(doc)));
    list.innerHTML = '';
    items.reverse().forEach((el) => list.appendChild(el));
    list.scrollTop = list.scrollHeight;
  }, (err) => {
    list.innerHTML = `<div class="community-message"><div class="text">Community feed unavailable.</div></div>`;
    console.warn(err);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    const text = input.value.trim();
    if (!user || !text) return;

    await db.collection('communityMessages').add({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'User',
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    input.value = '';
  });
})();
