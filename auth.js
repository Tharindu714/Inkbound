(function () {
  const fb = window.inkboundFirebase || {};
  const auth = fb.auth;
  const db = fb.db;

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg || '';
  }

  function redirectHome() {
    window.location.href = 'index.html';
  }

  async function ensureProfile(user, extra = {}) {
    if (!db || !user) return;
    const ref = db.collection('users').doc(user.uid);
    await ref.set({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || extra.displayName || '',
      photoURL: user.photoURL || '',
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...extra
    }, { merge: true });
  }

  if (!auth) {
    console.error('Firebase auth is not available.');
    return;
  }

  auth.onAuthStateChanged((user) => {
    if (user) redirectHome();
  });

  const signinForm = document.getElementById('signinForm');
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('signinError', '');
      const email = document.getElementById('signinEmail').value.trim();
      const password = document.getElementById('signinPassword').value;
      try {
        await auth.signInWithEmailAndPassword(email, password);
        await ensureProfile(auth.currentUser);
        redirectHome();
      } catch (err) {
        setError('signinError', err.message || 'Sign-in failed.');
      }
    });
  }

  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setError('signupError', '');
      const displayName = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        if (displayName) {
          await cred.user.updateProfile({ displayName });
        }
        await ensureProfile(cred.user, { displayName });
        redirectHome();
      } catch (err) {
        setError('signupError', err.message || 'Sign-up failed.');
      }
    });
  }
})();
