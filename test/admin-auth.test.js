const test = require('node:test');
const assert = require('node:assert');

// Set before server.js loads .env so these tests never touch the real database
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_KEY = 'test-key';
const app = require('../server');

async function withServer(run) {
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.close();
    }
}

test('admin API refuses requests without a token', () => withServer(async base => {
    assert.strictEqual((await fetch(`${base}/api/admin/students`)).status, 401);
    assert.strictEqual((await fetch(`${base}/api/admin/students/1`, { method: 'DELETE' })).status, 401);
    assert.strictEqual((await fetch(`${base}/api/admin/students`, { headers: { 'x-admin-token': 'made-up' } })).status, 401);
}));

test('kiosk can still read the calendar without a token, but not change it', () => withServer(async base => {
    assert.notStrictEqual((await fetch(`${base}/api/admin/calendar-activities`)).status, 401);
    assert.strictEqual((await fetch(`${base}/api/admin/calendar-activities`, { method: 'POST' })).status, 401);
}));
