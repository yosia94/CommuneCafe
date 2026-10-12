const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const HEADERS = [
  "Name",
  "Email",
  "WhatsApp",
  "Instagram",
  "Source",
  "Counselling Session",
  "Community",
  "Age",
  "Arrival Time",
  "Created Date",
  "Event Date",
  "Join Counts"
];

function resolveKeyFilePath() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH && fs.existsSync(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  }
  const candidatePaths = [
    path.join(__dirname, 'google-service-account.json'),
    path.join(__dirname, 'google-service-account.json.json')
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const files = fs.readdirSync(__dirname);
    const match = files.find(f => f.toLowerCase().includes('service-account') && (f.endsWith('.json') || f.endsWith('.json.json')));
    if (match) return path.join(__dirname, match);
  } catch (e) {}
  return null;
}

function getAuth() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID is not configured in .env");
  }

  // 1. Check if JSON key file exists
  const keyPath = resolveKeyFilePath();
  if (keyPath) {
    return new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  // 2. Check if credentials are directly in .env
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    return new google.auth.JWT(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
  }

  throw new Error(
    "No Google Service Account credentials found. Please place google-service-account.json in the project root or set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env"
  );
}

function isConfigured() {
  const hasSheetId = !!process.env.GOOGLE_SHEET_ID;
  const hasFile = !!resolveKeyFilePath();
  const hasEnvCredentials = !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  return hasSheetId && (hasFile || hasEnvCredentials);
}

function getGoogleSheetUrl() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null;
}

function formatPhoneNumber(wa) {
  if (!wa) return '';
  let str = String(wa).trim();
  // If Indonesian mobile number was entered without leading 0 (e.g. 812xxxx, 9-12 digits), prepend 0
  if (/^8\d{8,11}$/.test(str)) {
    str = '0' + str;
  }
  if (str.startsWith("'")) return str;
  // Prepend apostrophe so Google Sheets treats it as plain text and does not trim leading 0
  if (/^0\d+/.test(str) || /^\+?\d[\d\s-]*$/.test(str)) {
    return `'${str}`;
  }
  return str;
}

function formatParticipantRow(p) {
  let createdDateStr = '';
  const dateVal = p.created_date || p["Created Date"] || p["Registered Date"];
  if (dateVal) {
    const d = new Date(dateVal);
    createdDateStr = isNaN(d) ? dateVal : d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  }

  const rawWa = p.participants_wa || p.whatsapp || p.WhatsApp || '';

  return [
    p.participants_name || p.name || p.Name || '',
    p.participants_email || p.email || p.Email || '',
    formatPhoneNumber(rawWa),
    p.participants_ig || p.instagram || p.Instagram || '',
    p.source || p.Source || '',
    p.counselling_session || p.counselling || p["Counselling Session"] || '',
    p.community || p.Community || '',
    p.age || p.Age || '',
    p.time_arrival || p.eta || p["Arrival Time"] || '',
    createdDateStr || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    p.user_confirmation || p["Event Date"] || '',
    p.join_counts || p["Join Counts"] || ''
  ];
}

async function syncAllParticipants(participants) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const rows = [HEADERS];
  participants.forEach(p => {
    rows.push(formatParticipantRow(p));
  });

  // Clear existing content in sheet range A:Z
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: 'A:Z',
  });

  // Write new content
  const result = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
    },
  });

  return result;
}

async function appendParticipant(participant) {
  if (!isConfigured()) {
    console.warn("⚠️ Google Sheets is not configured. Skipping append.");
    return null;
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const row = formatParticipantRow(participant);

  const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return result;
}

module.exports = {
  isConfigured,
  getGoogleSheetUrl,
  syncAllParticipants,
  appendParticipant,
  HEADERS
};
