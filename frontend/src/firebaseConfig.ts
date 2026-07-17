// src/firebaseConfig.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyD6NrpxBwBOIZIPTWd49x1sh3gvUuQzxPc",
  authDomain: "school-ms-8097f.firebaseapp.com",
  projectId: "school-ms-8097f",
  storageBucket: "school-ms-8097f.firebasestorage.app",
  messagingSenderId: "980169532643",
  appId: "1:980169532643:web:54644e338973b9368351d6",
  measurementId: "G-8JNXYN3KGK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the auth instance so we can use it anywhere in React
export const auth = getAuth(app);
export const db = getFirestore(app);      // <-- NEW: Database for text messages
export const storage = getStorage(app);