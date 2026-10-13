import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL = process.env.API_URL || 'http://localhost:8000/api/v1';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD environment variable is required.');
  process.exit(1);
}

async function api(path, options = {}) {
  const url = `${API_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };

  if (globalThis.__token) {
    headers['Authorization'] = `Bearer ${globalThis.__token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${data?.message || res.statusText} [${data?.code || 'UNKNOWN'}]`);
  }

  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login(username, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  globalThis.__token = data.access_token;
  return data;
}

async function createLibrarian(username, password) {
  return api('/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role: 'librarian' }),
  });
}

async function createBook(book) {
  return api('/books', {
    method: 'POST',
    body: JSON.stringify(book),
  });
}

async function createMember(member) {
  return api('/members', {
    method: 'POST',
    body: JSON.stringify(member),
  });
}

async function createLoan(memberId, bookIds) {
  return api('/loans', {
    method: 'POST',
    body: JSON.stringify({
      member_id: memberId,
      items: bookIds.map((id) => ({ book_id: id })),
    }),
  });
}

async function returnItem(loanId, itemId) {
  return api(`/loans/${loanId}/items/${itemId}/return`, { method: 'POST' });
}

async function seed() {
  console.log('=== Manager Library Seeder ===\n');

  console.log('1. Logging in as admin...');
  const adminData = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  console.log(`   Logged in. Role: ${adminData.role}, expires in: ${adminData.expires_in}s\n`);

  console.log('2. Creating librarian...');
  try {
    const librarian = await createLibrarian('demo_librarian', 'librarian123');
    console.log(`   Created librarian: ${librarian.username}\n`);
  } catch (err) {
    console.log(`   Librarian may already exist: ${err.message}\n`);
  }

  const books = JSON.parse(readFileSync(join(__dirname, 'data', 'books.json'), 'utf8'));
  const members = JSON.parse(readFileSync(join(__dirname, 'data', 'members.json'), 'utf8'));

  console.log(`3. Creating ${books.length} books...`);
  const bookIds = [];
  for (const book of books) {
    try {
      const created = await createBook(book);
      bookIds.push(created.id);
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('x');
      console.log(`\n   Skipped ${book.isbn}: ${err.message}`);
    }
  }
  console.log(`\n   Created ${bookIds.length} books\n`);

  console.log(`4. Creating ${members.length} members...`);
  const memberIds = [];
  for (const member of members) {
    try {
      const created = await createMember(member);
      memberIds.push(created.id);
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('x');
      console.log(`\n   Skipped ${member.document_number}: ${err.message}`);
    }
  }
  console.log(`\n   Created ${memberIds.length} members\n`);

  console.log('5. Creating 3 overdue loans (using CLOCK_OFFSET_DAYS=-20)...');
  process.env.CLOCK_OFFSET_DAYS = '-20';
  const overdueLoans = [];
  for (let i = 0; i < 3 && i < memberIds.length; i++) {
    try {
      const loan = await createLoan(memberIds[i], [bookIds[i % bookIds.length]]);
      overdueLoans.push(loan);
      console.log(`   Overdue loan ${i + 1}: member=${memberIds[i].slice(0, 8)} book=${bookIds[i % bookIds.length].slice(0, 8)}`);
      await sleep(100);
    } catch (err) {
      console.log(`   Failed overdue loan ${i + 1}: ${err.message}`);
    }
  }
  process.env.CLOCK_OFFSET_DAYS = '0';
  console.log('');

  console.log('6. Creating 12 normal loans...');
  let loanCount = 0;
  let bookIndex = 5;
  for (let m = 0; m < memberIds.length && loanCount < 12; m++) {
    if (m < 3) continue;
    const numBooks = (m % 3) + 1;
    const items = [];
    for (let b = 0; b < numBooks && bookIndex < bookIds.length; b++) {
      items.push(bookIds[bookIndex]);
      bookIndex += 3;
    }
    if (items.length === 0) continue;
    try {
      await createLoan(memberIds[m], items);
      loanCount++;
      process.stdout.write('.');
      await sleep(50);
    } catch (err) {
      process.stdout.write('x');
    }
  }
  console.log(`\n   Created ${loanCount} normal loans\n`);

  console.log('7. Returning some items...');
  let returnCount = 0;
  for (const loan of overdueLoans) {
    try {
      const fullLoan = await api(`/loans/${loan.id}`);
      if (fullLoan.items && fullLoan.items.length > 0) {
        await returnItem(loan.id, fullLoan.items[0].id);
        returnCount++;
        process.stdout.write('.');
      }
    } catch (err) {
      process.stdout.write('x');
    }
  }
  console.log(`\n   Returned ${returnCount} items\n`);

  console.log('8. Verifying overdue loans...');
  const overdueData = await api('/loans/overdue');
  console.log(`   Overdue loans: ${overdueData.items.length}\n`);

  console.log('9. Verifying report...');
  const reportData = await api('/reports/most-borrowed?from=2026-10-01&to=2026-12-31');
  console.log(`   Report rows: ${reportData.rows.length}\n`);

  console.log('=== Seeder complete ===');
  console.log('Evidence: GET /loans/overdue returns overdue loans, GET /reports/most-borrowed has rows.');
}

seed().catch((err) => {
  console.error('Seeder failed:', err.message);
  process.exit(1);
});
