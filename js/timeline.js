import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collectionGroup,
  getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* Firebase config */
const firebaseConfig = {
  apiKey: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk",
  authDomain: "qrcodetesting-4f86e.firebaseapp.com",
  projectId: "qrcodetesting-4f86e",
  storageBucket: "qrcodetesting-4f86e.firebasestorage.app",
  messagingSenderId: "746921254909",
  appId: "1:746921254909:web:7acce026b9d96c97880394"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let cachedRuns = [];

export function clearCache(){
  cachedRuns = [];
}

export async function loadRuns(force = false) {
  if (!force && cachedRuns.length) return cachedRuns;

  const snap = await getDocs(collectionGroup(db, "runs"));
  const runs = [];
  snap.forEach(d => runs.push({ id: d.id, ...d.data() }));

  cachedRuns = runs;
  return runs;
}