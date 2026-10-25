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

test('a login token works on any server copy until it expires, and cannot be forged', () => withServer(async base => {
    const logout = token => fetch(`${base}/api/admin/logout`, { method: 'POST', headers: { 'x-admin-token': token } });
    // Issued by "another copy": nothing is kept in memory, so any copy accepts it
    const token = app.issueAdminToken();
    assert.strictEqual((await logout(token)).status, 200);

    const [expires, signature] = token.split('.');
    const sign = value => require('crypto').createHmac('sha256', 'test-key').update(`admin:${value}`).digest('hex');
    const past = Date.now() - 1000;
    assert.strictEqual((await logout(`${past}.${sign(past)}`)).status, 401); // expired
    assert.strictEqual((await logout(`${Number(expires) + 1}.${signature}`)).status, 401); // expiry changed, old signature
    assert.strictEqual((await logout(`${expires}.${'0'.repeat(signature.length)}`)).status, 401); // wrong signature
    assert.strictEqual((await logout(expires)).status, 401); // no signature
}));

test('kiosk can still read the calendar without a token, but not change it', () => withServer(async base => {
    assert.notStrictEqual((await fetch(`${base}/api/admin/calendar-activities`)).status, 401);
    assert.strictEqual((await fetch(`${base}/api/admin/calendar-activities`, { method: 'POST' })).status, 401);
}));
