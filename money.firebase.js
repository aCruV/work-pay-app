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
