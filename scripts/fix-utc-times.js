// One-off repair for rows saved while the server ran in UTC: their times are 8 hours early, and visits
// before 8 AM Philippine time got the previous day's date. A row was saved in UTC when its saved time
// matches the time of day in created_at (the database always stores created_at in UTC); only those rows
// get +8 hours, so rows saved in Philippine time are left alone and re-running is safe.
//
//   node scripts/fix-utc-times.js           dry run: shows what would change
//   node scripts/fix-utc-times.js --apply   backs up the tables to backups/ and writes the fixes
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const APPLY = process.argv.includes('--apply');
const SHIFT_SECONDS = 8 * 3600;

const toSeconds = time => { const [h, m, s] = time.split(':').map(Number); return h * 3600 + m * 60 + Math.floor(s); };
const toTime = seconds => {
    const s = ((seconds % 86400) + 86400) % 86400;
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
};
const shiftTime = time => toTime(toSeconds(time) + SHIFT_SECONDS);
const shiftDate = (date, time) => {
    if (toSeconds(time) + SHIFT_SECONDS < 86400) return date;
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
};
// Philippine date of the moment the row was created
const phDateOf = createdAt => new Date(new Date(`${createdAt.slice(0, 19)}Z`).getTime() + SHIFT_SECONDS * 1000).toISOString().slice(0, 10);
const savedInUtc = (time, createdAt) => {
    if (!time || !createdAt) return false;
    const diff = Math.abs(toSeconds(time) - toSeconds(createdAt.slice(11, 19)));
    return Math.min(diff, 86400 - diff) <= 120;
};

async function fetchAll(table, columns) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
    }
}

const tables = {
    library_logs: row => savedInUtc(row.check_in_time, row.created_at) && {
        action_date: phDateOf(row.created_at),
        check_in_time: shiftTime(row.check_in_time),
        check_out_time: row.check_out_time ? shiftTime(row.check_out_time) : null
    },
    // shortcut: assumes the return was saved by the same server as the borrow; true for every record before the time-zone fix
    borrow_records: row => savedInUtc(row.borrow_time, row.created_at) && {
        borrow_date: phDateOf(row.created_at),
        borrow_time: shiftTime(row.borrow_time),
        return_date: row.return_time ? shiftDate(row.return_date, row.return_time) : row.return_date,
        return_time: row.return_time ? shiftTime(row.return_time) : null
    },
    reading_sessions: row => savedInUtc(row.time_read, row.created_at) && {
        action_date: phDateOf(row.created_at),
        time_read: shiftTime(row.time_read)
    }
};

(async () => {
    const backupDir = path.join(__dirname, '..', 'backups', `utc-fix-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    for (const [table, fix] of Object.entries(tables)) {
        const rows = await fetchAll(table, '*');
        const changes = rows.map(row => ({ row, update: fix(row) })).filter(c => c.update);
        console.log(`${table}: ${changes.length} of ${rows.length} rows saved in UTC`);
        changes.slice(0, 2).forEach(({ row, update }) => console.log('   ', JSON.stringify(Object.fromEntries(Object.keys(update).map(k => [k, `${row[k]} -> ${update[k]}`])))));

        if (table === 'library_logs') {
            const odd = changes.filter(({ update: u }) => u.check_out_time && u.check_out_time < u.check_in_time);
            if (odd.length) console.log(`    note: ${odd.length} visits end after midnight once shifted (check-out earlier than check-in)`);
        }
        if (!APPLY || !changes.length) continue;

        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, `${table}.json`), JSON.stringify(rows, null, 2));
        for (let i = 0; i < changes.length; i += 10) {
            const results = await Promise.all(changes.slice(i, i + 10).map(({ row, update }) => supabase.from(table).update(update).eq('id', row.id)));
            const failed = results.find(r => r.error);
            if (failed) throw new Error(`${table}: update failed after ${i} rows: ${failed.error.message}. Backup: ${backupDir}`);
        }
        console.log(`    updated ${changes.length} rows (backup in ${backupDir})`);
    }
    if (!APPLY) console.log('\nDry run only. Re-run with --apply to write these changes.');
})().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
