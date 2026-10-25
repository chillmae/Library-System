const test = require('node:test');
const assert = require('node:assert');

// Set before server.js loads .env so these tests never touch the real database
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_KEY = 'test-key';
const { buildBookRecord, renewalDueDate, reportMonth, inMonth, buildOpacCatalog } = require('../server');

test('OPAC groups copies under one title and marks only copies with an open loan as on loan', () => {
    const books = [
        { book_id: 'BK1', accession_number: '000002', title: 'Diksiyonaryo', author: 'Nicasio', copy_no: '2', call_number: 'GEN 400 N513', category: 'General References' },
        { book_id: 'BK1', accession_number: '000001', title: 'Diksiyonaryo', author: 'Nicasio', copy_no: '1', call_number: 'GEN 400 N513', category: 'General References' },
        // added before the OPAC import: no book_id, grouped by title + author
        { accession_number: '000900', title: 'Abundance  of Katherines', author: 'John Green', call_number: 'FIC G796' },
        { accession_number: '000901', title: 'abundance of katherines', author: 'John Green', call_number: 'FIC G796' }
    ];
    const titles = buildOpacCatalog(books, [{ item_code: '000002', due_date: '2026-10-30', student_name: 'Juan Dela Cruz' }, { item_code: '000901', due_date: null }]);
    assert.deepStrictEqual(titles.map(t => [t.title, t.copies.length]), [['Abundance  of Katherines', 2], ['Diksiyonaryo', 2]]);
    const dict = titles[1];
    assert.deepStrictEqual(dict.copies.map(c => [c.copy_no, c.on_loan, c.due_date]), [['1', false, null], ['2', true, '2026-10-30']]);
    assert.strictEqual(titles[0].copies.find(c => c.accession === '000901').on_loan, true); // pending loan, no due date yet
    assert.ok(!JSON.stringify(titles).includes('Juan'), 'no borrower details in the public catalog');
});

test('report month: YYYY-MM or none; anything else is rejected', () => {
    assert.strictEqual(reportMonth({ query: { month: '2026-09' } }), '2026-09');
    assert.strictEqual(reportMonth({ query: {} }), '');
    for (const bad of ['2026-13', '2026-9', 'abc', '2026-09-01']) assert.strictEqual(reportMonth({ query: { month: bad } }), null);
});

test('a month covers its first day up to (not including) the next month, across a year end', () => {
    const calls = [];
    const query = { gte: (col, v) => (calls.push(['gte', col, v]), query), lt: (col, v) => (calls.push(['lt', col, v]), query) };
    inMonth(query, '2026-12');
    assert.deepStrictEqual(calls, [['gte', 'action_date', '2026-12-01'], ['lt', 'action_date', '2027-01-01']]);
    assert.strictEqual(inMonth(query, ''), query); // no month: unchanged
    assert.strictEqual(calls.length, 2);
});

test('renewal adds 3 days for learners and 5 for faculty, counted from the due date', () => {
    assert.strictEqual(renewalDueDate('2026-10-16', false), '2026-10-19');
    assert.strictEqual(renewalDueDate('2026-10-16', true), '2026-10-21');
    assert.strictEqual(renewalDueDate('2026-10-30', false), '2026-11-02'); // across a month end
    assert.strictEqual(renewalDueDate('2026-12-30', true), '2027-01-04'); // across a year end
});

test('placeholder call numbers fall back to the DDC No.', () => {
    for (const placeholder of ['1', '-', '', ' 1 ']) {
        assert.strictEqual(buildBookRecord({ call_number: placeholder, ddc_no: 'GEN   400  N513' }).call_number, 'GEN 400 N513');
    }
    assert.strictEqual(buildBookRecord({ call_number: 'FIC P967', ddc_no: 'FIC' }).call_number, 'FIC P967');
    assert.strictEqual(buildBookRecord({ call_number: '000', ddc_no: '000' }).call_number, '000');
});

test('category must be a real one: typed in any case, or taken from the shelf code', () => {
    assert.strictEqual(buildBookRecord({ category: 'fiction' }).category, 'Fiction');
    assert.strictEqual(buildBookRecord({ category: '1', ddc_no: 'FIL 900 R147' }).category, 'Filipiniana');
    assert.strictEqual(buildBookRecord({ category: '', call_number: 'LAR 300 F178' }).category, 'Learning Area References');
    // Nothing to work it out from: left empty so add/update/import reject the book
    assert.strictEqual(buildBookRecord({ category: '1', ddc_no: '500.1' }).category, '');
});
