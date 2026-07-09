/* ================================================================
   1) PASTE YOUR FIREBASE CONFIG HERE
   Firebase console → Project settings → Your apps → Web app → Config
================================================================ */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAK_glHr_1SxqcfvAjCvvrMDsmNTzwUsqQ",
  authDomain: "justpoint-311b2.firebaseapp.com",
  projectId: "justpoint-311b2",
  storageBucket: "justpoint-311b2.firebasestorage.app",
  messagingSenderId: "701063680168",
  appId: "1:701063680168:web:dbff3b0cdc5fbe9338f29d",
};

/* ================================================================
   2) MAP EACH LOGIN EMAIL TO A DISPLAY NAME AND ROLE
   role: 'owner' (files change requests) or 'dev' (implements them)
   Anyone signed in but not listed here defaults to 'owner'.
================================================================ */
export const USERS = {
  "lucas@mammacare.org": { name: "Lucas", role: "dev" },
  "webmaster@mammacare.org": { name: "Zach", role: "dev" },
  "markgoldstein@mammacare.org": { name: "Mark", role: "owner" },
  "trainingg@mammacare.org": { name: "Mary", role: "owner" },
};

export const configured =
  FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "PASTE_ME";
