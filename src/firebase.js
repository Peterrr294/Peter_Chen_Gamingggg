import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDtDICwgvxeB1fjDN96CUGkugnZbsO_wlk',
  authDomain: 'gameeeee-zc626.firebaseapp.com',
  projectId: 'gameeeee-zc626',
  storageBucket: 'gameeeee-zc626.firebasestorage.app',
  messagingSenderId: '325953195793',
  appId: '1:325953195793:web:860f33db8d7aaf9a5606b0',
  measurementId: 'G-ZQTBZGEM1R',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { app, auth, db, googleProvider };
