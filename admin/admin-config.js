/*  admin-config.js — UniQueue Admin Shared Configuration
 *
 *  This file lives inside /admin/ which is protected by the server's
 *  IP whitelist + API key middleware. It is never served to the public.
 *
 *  HOW TO SET YOUR API KEY:
 *  Replace the ADMIN_API_KEY value below with the same string you set
 *  in your .env file on the EC2 server. Keep this file private.
 */

/* ── API Key (must match ADMIN_API_KEY in your .env) ── */
export const ADMIN_API_KEY = 'change-this-to-a-long-random-secret-string';

/* ── Firebase Config ── */
export const firebaseConfig = {
  apiKey:            'AIzaSyDzK9bpl2C_n0YN5WJyTXYXdGUGDWD1TGA',
  authDomain:        'queue-system-45b56.firebaseapp.com',
  databaseURL:       'https://queue-system-45b56-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'queue-system-45b56',
  storageBucket:     'queue-system-45b56.firebasestorage.app',
  messagingSenderId: '675517760534',
  appId:             '1:675517760534:web:da32b63a86f7c67d9b2137',
};

/* ── University Settings ── */
export const UNI_NAME  = "University Registrar's Office";
export const UNI_LABEL = 'Queue Management System · Academic Year 2025–2026';
export const APP_DL_URL = 'https://uniqueue.app/download';

/* ── Default Admin Accounts ──
 *  These are the seed accounts used if Firebase has no admins yet.
 *  Stored and served only from the protected /admin/ route.
 *  Change passwords before going live.
 *
 *  `window` ties an account to one physical counter within its
 *  department (Registrar has 7, Accounting has 4, Scholarship has 3).
 *  Add more accounts (via the Super Admin console) to staff additional
 *  windows — each new account just needs a department + an unused
 *  window number.
 */
export const DEFAULT_ADMINS = [
  { username: 'Accounting Office',              password: 'acc1234',   role: 'Staff', department: 'accounting',  window: 1 },
  { username: "Registrar's Office",             password: 'reg1234',   role: 'Staff', department: 'registrar',   window: 1 },
  { username: 'Scholarships and Grants Office', password: 'sched1234', role: 'Staff', department: 'scholarship', window: 1 },
];

/* ── Default Super Admin Account ──
 *  Seed account used if Firebase has no `superAdmins` node yet.
 *  Change this password before going live — the Super Admin console
 *  can add more super admin accounts once you're logged in with this one.
 */
export const DEFAULT_SUPERADMINS = [
  { username: 'superadmin', password: 'super1234' },
];
