// This config is meant to be public; access is enforced by firestore.rules and Firebase Auth.
const firebaseConfig = {
  apiKey: "AIzaSyCSSrv-SZKozD_ITcS6OSgJOjOyvWaZFPE",
  authDomain: "shifts-app-7602e.firebaseapp.com",
  projectId: "shifts-app-7602e",
  storageBucket: "shifts-app-7602e.firebasestorage.app",
  messagingSenderId: "496765393592",
  appId: "1:496765393592:web:6b3a50de85cd5e8c9cf24d"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
// Keeps a local copy so edits made offline survive a reload and sync when back online.
db.enablePersistence({ synchronizeTabs: true }).catch(err => console.warn('Offline persistence unavailable:', err.code));
