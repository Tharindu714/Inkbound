(function () {
  const fb = window.inkboundFirebase || {};
  const auth = fb.auth;
  const db = fb.db;
  const storage = fb.storage;

  const authStatus = document.getElementById('authStatus');
  const signInLink = document.getElementById('signInLink');
  const signOutBtn = document.getElementById('signOutBtn');
  const openCommunityBtn = document.getElementById('openCommunityBtn');
  const communityPanel = document.getElementById('communityPanel');
  const closeCommunityBtn = document.getElementById('closeCommunityBtn');

  function setAuthStatus(text) {
    if (authStatus) authStatus.textContent = text;
  }

  function showAuthActions(user) {
    if (signInLink) signInLink.classList.toggle('hidden', !!user);
    if (signOutBtn) signOutBtn.classList.toggle('hidden', !user);
  }

  async function saveMeta(user, filename, doc, outBytes) {
    if (!db) return;
    const docId = doc.id || `doc_${Date.now()}`;
    const size = outBytes.byteLength || outBytes.length || 0;
    const folder = `users/${user.uid}/pdfs`;
    const path = `${folder}/${docId}-${Date.now()}.pdf`;
    let downloadURL = '';

    if (storage) {
      const storageRef = storage.ref(path);
      const snapshot = await storageRef.put(new Blob([outBytes], { type: 'application/pdf' }));
      downloadURL = await snapshot.ref.getDownloadURL();
    }

    await db.collection('users').doc(user.uid).collection('documents').doc(docId).set({
      docId,
      originalName: doc.name || filename,
      filename,
      storagePath: path,
      downloadURL,
      size,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { docId, path, downloadURL };
  }

  window.cloudSaveEditedPdf = async function cloudSaveEditedPdf(doc, outBytes, filename) {
    if (!auth || !auth.currentUser) return null;
    return saveMeta(auth.currentUser, filename, doc, outBytes);
  };

  async function loadRecentDocs(user) {
    if (!db) return;
    const list = await db.collection('users').doc(user.uid).collection('documents')
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get();

    const hint = document.getElementById('communityHint');
    if (hint && !list.empty) {
      hint.textContent = 'Your recent exported PDFs will appear in Firebase Storage.';
    }

    return list.docs.map(d => d.data());
  }

  if (!auth) return;

  auth.onAuthStateChanged(async (user) => {
    showAuthActions(user);

    if (user) {
      setAuthStatus(`Signed in as ${user.displayName || user.email}`);
      if (signInLink) signInLink.textContent = 'Account';
      await loadRecentDocs(user).catch(console.warn);
    } else {
      setAuthStatus('Not signed in');
      if (signInLink) signInLink.textContent = 'Sign in';
      const isAuthPage = location.pathname.endsWith('signin.html') || location.pathname.endsWith('signup.html');
      if (!isAuthPage) {
        location.href = 'signin.html';
      }
    }
  });

  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await auth.signOut();
      location.href = 'signin.html';
    });
  }

  if (openCommunityBtn && communityPanel) {
    openCommunityBtn.addEventListener('click', () => {
      communityPanel.classList.remove('hidden');
      communityPanel.setAttribute('aria-hidden', 'false');
    });
  }

  if (closeCommunityBtn && communityPanel) {
    closeCommunityBtn.addEventListener('click', () => {
      communityPanel.classList.add('hidden');
      communityPanel.setAttribute('aria-hidden', 'true');
    });
  }
})();
