const path    = require('path');
const express = require('express');
const fs      = require('fs');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ─────────────────────────────────────────────────────────────
//  PRINTER CONFIG & ESC/POS HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────
const PRINTER_PATH = process.env.PRINTER_PATH || '\\\\.\\COM3';
const ESC = 0x1b;
const GS  = 0x1d;
const Name = 'Quelio';

function escpos(ticketId, deptLabel, uniName, issuedAt) {
  const chunks = [];
  const b = (...bytes) => chunks.push(Buffer.from(bytes));
  const t = (str)      => chunks.push(Buffer.from(str + '\n', 'utf8'));

  // Format today's date as MM/DD/YYYY
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  const dateToday = `${month}/${day}/${year}`;

  // Initialize printer
  b(ESC, 0x40);

  // Center alignment
  b(ESC, 0x61, 0x01);

  // --- TOP HEADER (Quelio) ---
  b(GS, 0x21, 0x11);   // Double height + double width
  b(ESC, 0x45, 0x01);  // Bold ON
  t(Name);             
  b(ESC, 0x45, 0x00);  // Bold OFF
  b(GS, 0x21, 0x00);   // Normal size

  t('--------------------------------');

  // --- "YOUR NUMBER" & TICKET ID ---
  t('YOUR NUMBER');

  // Ticket Number (Quad Size: 4x Width, 4x Height)
  b(GS, 0x21, 0x33);   
  b(ESC, 0x45, 0x01);  
  t(ticketId);
  b(GS, 0x21, 0x00);   
  b(ESC, 0x45, 0x00);  

  t('');
  
  // --- ISSUED TIME & DATE ---
  b(GS, 0x21, 0x10);
  t('Date: ' + dateToday);
  t('Issued: ' + issuedAt);
  b(GS, 0x21, 0x00);

  t('--------------------------------');
  t('');
  t('QUELIO QUEUE SYSTEM ');
  t('');
  t('');
  t('');
  
  // Cut paper command
  b(GS, 0x56, 0x00);

  return Buffer.concat(chunks);
}

app.post('/print', (req, res) => {
  const { ticketId, deptLabel, uniName, issuedAt } = req.body;

  if (!ticketId || !deptLabel) {
    return res.status(400).json({ ok: false, error: 'Missing ticketId or deptLabel' });
  }

  // Create formatted receipt buffer (without QR commands)
  const receiptBuf = escpos(
    ticketId, 
    deptLabel, 
    uniName || 'Quelio', 
    issuedAt || new Date().toLocaleTimeString()
  );

  fs.open(PRINTER_PATH, 'w', (err, fd) => {
    if (err) {
      console.error('[print] Cannot open printer at', PRINTER_PATH, '—', err.message);
      return res.status(500).json({ ok: false, error: 'Printer not found at ' + PRINTER_PATH + '. Check PRINTER_PATH in index.js.' });
    }
    fs.write(fd, receiptBuf, (werr) => {
      fs.close(fd, () => {});
      if (werr) {
        console.error('[print] Write error:', werr.message);
        return res.status(500).json({ ok: false, error: werr.message });
      }
      console.log('[print] Sent enlarged ticket', ticketId, 'to', PRINTER_PATH);
      res.json({ ok: true });
    });
  });
});

// Main Admin Portal (defaults to the registrar view)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'registrar_1.html'));
});

// Registrar Portal
app.get('/registrar', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'registrar_1.html'));
});

// Accounting Portal
app.get('/accounting', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'accounting_1.html'));
});

// Scholarship Portal
app.get('/scholarship', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'scholarship_1.html'));
});

// Super Admin Portal (front-end shell for now — no backend wiring yet)
app.get('/superadmin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'superadmin.html'));
});

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});

app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

app.get('/tv', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tv_1.html'));
});

app.listen(80, '0.0.0.0', () => {
  console.log('Server running on :80');
  console.log('Printer path:', PRINTER_PATH);
});