#!/usr/bin/env node
//
// Turns the student roster spreadsheet into one personal access link per student.
//
//   STUDENT_LINK_SECRET=... node scripts/make-student-links.js \
//     --roster "Synthesis Supercollaborators - Sheet1.csv" \
//     --base-url https://discussion-session-authoring-tool.vercel.app \
//     --out student-links.csv
//
// The secret must be the same value set as STUDENT_LINK_SECRET in the Vercel project
// settings, or the links will not verify against the deployed API. Tokens are derived
// from the username, so re-running this produces identical links — safe to repeat, and
// there is no state to keep in sync.
//
// The output file contains 80-odd working credentials. Both it and the roster are
// covered by .gitignore and .vercelignore; keep it that way.

const fs = require('fs');
const path = require('path');

// One shared definition of the token format, so the generator and the API that
// verifies these links can never drift apart.
const { issueStudentToken } = require(path.join(__dirname, '..', 'api', 'storage.js'));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Small hand-rolled parser rather than a dependency: the roster quotes fields that
// contain commas ("October 17, 2024"), so splitting on commas corrupts every column
// after the first such row.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvCell(v) {
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(1);
}

const secret = process.env.STUDENT_LINK_SECRET;
if (!secret) {
  fail('STUDENT_LINK_SECRET is not set.\n' +
       '  Generate one with:  openssl rand -base64 32\n' +
       '  Then set the same value in the Vercel project settings and redeploy.');
}

const rosterPath = arg('roster', 'Synthesis Supercollaborators - Sheet1.csv');
const baseUrl = arg('base-url');
const outPath = arg('out', 'student-links.csv');

if (!baseUrl) fail('--base-url is required, e.g. --base-url https://your-app.vercel.app');
if (!fs.existsSync(rosterPath)) fail('Roster not found: ' + rosterPath);

const rows = parseCsv(fs.readFileSync(rosterPath, 'utf8')).filter(r => r.some(c => c.trim()));
if (!rows.length) fail('Roster is empty: ' + rosterPath);

const header = rows[0].map(h => h.trim().toLowerCase());
const userCol = header.indexOf('username');
const nameCol = header.indexOf('name');
if (userCol === -1) fail("No 'Username' column in " + rosterPath + '. Found: ' + rows[0].join(', '));

const origin = baseUrl.replace(/\/+$/, '');
const seen = new Map();
const out = [];
let skipped = 0;

rows.slice(1).forEach((r, i) => {
  const username = (r[userCol] || '').trim(); // several roster rows carry stray spaces
  if (!username) { skipped++; return; }
  const key = username.toLowerCase();
  if (seen.has(key)) {
    fail('Duplicate username "' + username + '" on rows ' + seen.get(key) + ' and ' + (i + 2) +
         '.\n  Two students would share one set of drafts. Fix the roster and re-run.');
  }
  seen.set(key, i + 2);
  const token = issueStudentToken(username);
  if (!token) fail('Could not build a token for "' + username + '" (row ' + (i + 2) + ').');
  out.push({
    name: nameCol === -1 ? '' : (r[nameCol] || '').trim(),
    username: username,
    link: origin + '/?s=' + encodeURIComponent(token),
  });
});

if (!out.length) fail('No usable usernames found in ' + rosterPath);

fs.writeFileSync(outPath,
  'Name,Username,Link\n' +
  out.map(s => [s.name, s.username, s.link].map(csvCell).join(',')).join('\n') + '\n');

console.log('Wrote ' + out.length + ' links to ' + outPath);
if (skipped) console.log('Skipped ' + skipped + ' row(s) with no username.');
console.log('\nSpot-check one before sending:\n  ' + out[0].username + '  ' + out[0].link);
console.log('\nThis file is a set of working credentials — it is gitignored, keep it out of email threads\n' +
            'other than the one-to-one messages to each student.');
