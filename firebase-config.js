// firebase-config.js
const firebaseConfig = {
  apiKey: "AIzaSyD-4Qv4eZLM4mT4rDQswFjYerojrrGUuGQ",
  authDomain: "inkbound-pdf.firebaseapp.com",
  projectId: "inkbound-pdf",
  storageBucket: "inkbound-pdf.firebasestorage.app",
  messagingSenderId: "780485094389",
  appId: "1:780485094389:web:a60d10f5d714d6291a8ebc",
  measurementId: "G-RK5JSENW3B"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

window.inkboundFirebase = { auth, db, storage };