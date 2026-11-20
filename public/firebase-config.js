/*  firebase-config.js — UniQueue Public Configuration
 *
 *  Used by kiosk.html and tv_1.html / tv_voice_updated.html only.
 *  These are public-facing display pages. They only READ queue/lane
 *  data from Firebase — they never access admin accounts or passwords.
 *
 *  Firebase API keys for web clients are NOT secret by themselves —
 *  security is enforced by Firebase security rules on the database.
 *  Make sure your Firebase Realtime DB rules allow public read of
 *  /queue, /lanes, /presence, /deptCounters but block all writes
 *  from unauthenticated clients.
 */

export const firebaseConfig = {
  apiKey:            'AIzaSyDzK9bpl2C_n0YN5WJyTXYXdGUGDWD1TGA',
  authDomain:        'queue-system-45b56.firebaseapp.com',
  databaseURL:       'https://queue-system-45b56-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'queue-system-45b56',
  storageBucket:     'queue-system-45b56.firebasestorage.app',
  messagingSenderId: '675517760534',
  appId:             '1:675517760534:web:da32b63a86f7c67d9b2137',
};

export const UNI_NAME   = "University Registrar's Office";
export const UNI_LABEL  = 'Queue Management System · Academic Year 2025–2026';
export const APP_DL_URL = 'https://uniqueue.app/download';
