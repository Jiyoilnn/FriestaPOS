// Friesta cloud sync (optional).
//
// Leave FIREBASE_CONFIG as null to run fully offline: everything is saved on the
// device, and the POS and Back Office share data when they are opened on the
// same phone, tablet or computer.
//
// To sync between devices (e.g. POS on the store tablet, Back Office on your
// phone at home), create a free Firebase project and paste its web config here.
// Step-by-step guide: docs/SETUP.md
//
// Example:
// export const FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "friesta-pos.firebaseapp.com",
//   projectId: "friesta-pos",
//   storageBucket: "friesta-pos.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abc123"
// };

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD2BqHHoOjKAMteIUvksKJMpy4KzqxD6zw",
  authDomain: "friesta-pos.firebaseapp.com",
  projectId: "friesta-pos",
  storageBucket: "friesta-pos.firebasestorage.app",
  messagingSenderId: "555938165674",
  appId: "1:555938165674:web:7b1ae49bcda82964d9b1d3"
};

// Firebase JS SDK version loaded from Google's CDN when cloud sync is on.
export const FIREBASE_VERSION = "10.12.2";
