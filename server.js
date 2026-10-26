require('dotenv').config();
// All dates/times this server saves are Philippine time, even when the host (e.g. Vercel) runs in UTC
process.env.TZ = 'Asia/Manila';
const express = require('express');
const { createHmac, timingSafeEqual } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middleware (grouped cleanly together)
app.use(express.json({ limit: '5mb' })); // bulk imports send the whole sheet in one request
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Serves your frontend files

// Vercel Routing Fix
app.get('/', (req, res) => {
    res.redirect('/index.html');
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Admin login token "<expiry ms>.<signature>", signed with the secret Supabase key. Any copy of the server can
// check it without shared memory: Vercel runs many short-lived copies, so a token kept in memory got lost.
const ADMIN_TOKEN_HOURS = 12;
const signAdminToken = expires => createHmac('sha256', process.env.SUPABASE_KEY).update(`admin:${expires}`).digest('hex');

function issueAdminToken() {
    const expires = Date.now() + ADMIN_TOKEN_HOURS * 60 * 60 * 1000;
    return `${expires}.${signAdminToken(expires)}`;
}

function isValidAdminToken(token) {
    const [expires, signature] = String(token || '').split('.');
    if (!(Number(expires) > Date.now()) || !signature) return false;
    const expected = Buffer.from(signAdminToken(expires));
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
}

app.use('/api/admin', (req, res, next) => {
    // The kiosk shows the calendar without an admin login
    if (req.method === 'GET' && req.path === '/calendar-activities') return next();
    if (isValidAdminToken(req.get('x-admin-token'))) return next();
    res.status(401).json({ error: 'Admin login required.' });
});

// shortcut: logout only drops the token in the browser; a copied token keeps working until it expires
// (12 hours). Add a table of revoked tokens if admins must be able to end a session on another device.
app.post('/api/admin/logout', (req, res) => {
    res.json({ success: true });
});

// Supabase returns at most 1000 rows per request, so page through until a short page comes back
async function fetchAll(buildQuery) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await buildQuery().order('id').range(from, from + 999);
        if (error) return { data: null, error };
        rows.push(...data);
        if (data.length < 1000) return { data: rows, error: null };
    }
}

// A report's ?month=YYYY-MM: '' when none was asked for, null when it is malformed
function reportMonth(req) {
    const month = String(req.query.month || '');
    return !month || /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

// Limits a query to one month by its action_date; no month = every month
function inMonth(query, month) {
    if (!month) return query;
    const [year, monthNumber] = month.split('-').map(Number);
    const nextMonthStart = new Date(year, monthNumber, 1).toLocaleDateString('sv'); // monthNumber is 1-based, so this is next month
    return query.gte('action_date', `${month}-01`).lt('action_date', nextMonthStart);
}

const BAD_MONTH_MESSAGE = 'Choose a month, e.g. 2026-09.';

const BOOK_CATEGORIES = ['Filipiniana', 'General References', 'Learning Area References', 'Supplementary Reading Remediation Materials', 'Fiction', 'Learning Activity Sheets'];
// Shelf code at the start of a DDC/call number, e.g. "GEN 400 N513"
const CATEGORY_BY_SHELF_CODE = { GEN: 'General References', FIL: 'Filipiniana', LAR: 'Learning Area References', FIC: 'Fiction' };
const SHELF_CODE_BY_CATEGORY = Object.fromEntries(Object.entries(CATEGORY_BY_SHELF_CODE).map(([code, name]) => [name, code]));
const INVALID_CATEGORY_MESSAGE = `Category must be one of: ${BOOK_CATEGORIES.join(', ')}.`;

// A valid category name, or '' when none can be worked out (the caller rejects the book)
function normalizeBookCategory(category, shelfNumber) {
    const typed = String(category || '').trim().toLowerCase();
    return BOOK_CATEGORIES.find(c => c.toLowerCase() === typed)
        || CATEGORY_BY_SHELF_CODE[String(shelfNumber || '').trim().split(' ')[0].toUpperCase()]
        || '';
}

function buildBookRecord(input = {}) {
    const remarksValue = (input.remarks ?? input.remark ?? input.remarks_text ?? input.notes ?? '').toString().trim();
    const collapse = value => (value ?? '').toString().trim().replace(/\s+/g, ' ');
    const ddcNo = collapse(input.ddc_no || input.ddc);
    const typedCallNumber = collapse(input.call_number || input.callNumber || input.call_no);
    // "1", "-" or blank were typed just to fill a required box (384 books imported that way), so use the DDC No.
    const callNumber = /^[-.\s]*\d?[-.\s]*$/.test(typedCallNumber) ? ddcNo : typedCallNumber;
    return {
        accession_number: (input.accession_number || input.accessionNumber || '').toString().trim(),
        call_number: callNumber,
        title: (input.title || input.name || '').toString().trim(),
        author: (input.author || '').toString().trim(),
        category: normalizeBookCategory(input.category, ddcNo || callNumber),
        copyright_year: input.copyright_year ? parseInt(input.copyright_year, 10) : null,
        isbn: (input.isbn || '').toString().trim() || null,
        date_received: input.date_received || null,
        ddc_no: ddcNo || null,
        edition: (input.edition || '').toString().trim() || null,
        volumes: (input.volumes || '').toString().trim() || null,
        pages: (input.pages || '').toString().trim() || null,
        source_of_fund: (input.source_of_fund || input.source_of_found || '').toString().trim() || null,
        price: input.price ? parseFloat(input.price) : null,
        publisher: (input.publisher || '').toString().trim() || null,
        remarks: remarksValue || null
    };
}

function isMissingColumnError(error) {
    const message = error?.message || '';
    return error?.code === '42703' || error?.code === '42P01' || /column/i.test(message) && /does not exist/i.test(message);
}

function isMissingTableError(error) {
    const message = error?.message || '';
    const normalized = message.toLowerCase();
    return error?.code === '42P01' ||
        (normalized.includes('relation') && normalized.includes('does not exist')) ||
        (normalized.includes('could not find the table') || normalized.includes('schema cache')) ||
        (normalized.includes('does not exist') && normalized.includes('table'));
}

function normalizeCalendarActivityValue(value) {
    if (!value) return new Date().toISOString();

    const raw = String(value).trim();
    if (!raw) return new Date().toISOString();

    const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})?$/);
    if (directMatch) {
        const [, year, month, day, hours, minutes, seconds = '00'] = directMatch;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
        return parsed.toISOString();
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
    }

    return new Date().toISOString();
}

function prepareBookImportRows(payload = []) {
    const seen = new Set();
    const rows = [];

    (payload || []).forEach(record => {
        const row = buildBookRecord(record);
        // The upsert must not blank out details an existing book already has when the import didn't send that column
        Object.keys(row).forEach(key => { if (row[key] === null && !Object.hasOwn(record, key)) delete row[key]; });
        if (!row.accession_number || !row.call_number || !row.title || !row.author || !row.category) {
            return;
        }
        if (seen.has(row.accession_number)) {
            return;
        }
        seen.add(row.accession_number);
        rows.push(row);
    });

    return rows;
}

function buildInventoryWeedingRecord(input = {}) {
    return {
        accession_no: (input.accession_no || input.accessionNumber || '').toString().trim() || null,
        date_received: input.date_received || null,
        ddc_no: (input.ddc_no || input.ddc || '').toString().trim() || null,
        author: (input.author || '').toString().trim() || null,
        title: (input.title || '').toString().trim() || null,
        condition: (input.condition || '').toString().trim() || null,
        action_taken: (input.action_taken || '').toString().trim() || null,
        remarks: (input.remarks || '').toString().trim() || null,
        date_of_inventory: input.date_of_inventory || null
    };
}

// --- API ROUTES ---

// 1. Authenticate (Students use ID only; Faculty use ID only; Admin uses ID + Password)
app.post('/api/authenticate', async (req, res) => {
    const { student_id, user_type, password } = req.body;

    // Validate input
    if (!student_id || typeof student_id !== 'string') {
        return res.status(400).json({ error: 'Please enter a valid ID.' });
    }

    const trimmedId = student_id.trim();
    if (trimmedId.length === 0) {
        return res.status(400).json({ error: 'ID cannot be empty.' });
    }

    // If admin login, check users table
    if (user_type === 'admin' || (!user_type && password)) {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('student_id', trimmedId)
            .single();

        if (!user) return res.status(401).json({ error: 'Admin ID not found. Please check your ID.' });

        if (user.role === 'admin') {
            if (!password || user.password !== password) {
                return res.status(401).json({ error: 'Invalid admin password. Access denied.' });
            }
            return res.json({ status: 'success', role: 'admin', user_id: user.id, name: user.name, token: issueAdminToken() });
        }
        return res.status(401).json({ error: 'Not an admin account.' });
    }

    // If faculty login
    if (user_type === 'faculty') {
        const { data: faculty, error } = await supabase
            .from('faculty')
            .select('*')
            .eq('faculty_id', trimmedId)
            .single();

        if (!faculty) return res.status(401).json({ error: 'Faculty ID not found. Please check your ID.' });

        const today = new Date().toLocaleDateString('sv');
        const { data: activeLog } = await supabase
            .from('library_logs')
            .select('*')
            .eq('user_id', faculty.id)
            .eq('user_type', 'faculty')
            .eq('action_date', today)
            .is('check_out_time', null)
            .single();

        if (activeLog) {
            return res.json({
                status: 'success',
                role: 'faculty',
                intent: 'check-out',
                log_id: activeLog.id,
                user_id: faculty.id,
                name: faculty.name || 'Faculty',
                position: faculty.position || 'N/A',
                check_in_time: activeLog.check_in_time,
                visit_reason: activeLog.visit_reason
            });
        } else {
            return res.json({
                status: 'success',
                role: 'faculty',
                intent: 'check-in',
                user_id: faculty.id,
                name: faculty.name || 'Faculty',
                position: faculty.position || 'N/A'
            });
        }
    }

    // If stakeholder login
    if (user_type === 'stakeholder') {
        const { data: stakeholder, error } = await supabase
            .from('users')
            .select('*')
            .eq('student_id', trimmedId)
            .eq('role', 'stakeholder')
            .single();

        if (!stakeholder) return res.status(401).json({ error: 'Stakeholder ID not found. Please check your ID.' });

        const today = new Date().toLocaleDateString('sv');
        const { data: activeLog } = await supabase
            .from('library_logs')
            .select('*')
            .eq('user_id', stakeholder.id)
            .eq('action_date', today)
            .is('check_out_time', null)
            .single();

        if (activeLog) {
            return res.json({
                status: 'success',
                role: 'stakeholder',
                intent: 'check-out',
                log_id: activeLog.id,
                user_id: stakeholder.id,
                name: stakeholder.name || 'Stakeholder',
                organization: stakeholder.section || 'N/A',
                position: stakeholder.grade || 'N/A',
                section: stakeholder.section || 'N/A',
                contact_number: stakeholder.contact_number || 'N/A',
                check_in_time: activeLog.check_in_time,
                visit_reason: activeLog.visit_reason
            });
        }

        return res.json({
            status: 'success',
            role: 'stakeholder',
            intent: 'check-in',
            user_id: stakeholder.id,
            name: stakeholder.name || 'Stakeholder',
            organization: stakeholder.section || 'N/A',
            position: stakeholder.grade || 'N/A',
            section: stakeholder.section || 'N/A',
            contact_number: stakeholder.contact_number || 'N/A'
        });
    }

    // IF STUDENT: Check users table
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('student_id', trimmedId)
        .eq('role', 'student')
        .single();

    if (!user) return res.status(401).json({ error: 'Student ID not found. Please check your ID.' });

    // IF ADMIN: Enforce password check
    if (user.role === 'admin') {
        if (!password || user.password !== password) {
            return res.status(401).json({ error: 'Invalid admin password. Access denied.' });
        }
        return res.json({ status: 'success', role: 'admin', user_id: user.id, name: user.name, token: issueAdminToken() });
    }

    // IF STUDENT: Skip password entirely and manage check-in/out log status
    const today = new Date().toLocaleDateString('sv'); 
    const { data: activeLog } = await supabase
        .from('library_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('user_type', 'student')
        .eq('action_date', today)
        .is('check_out_time', null)
        .single();

    if (activeLog) {
        return res.json({ 
            status: 'success', 
            role: 'student', 
            intent: 'check-out', 
            log_id: activeLog.id, 
            user_id: user.id,
            name: user.name || 'Student',
            grade: user.grade || 'N/A',
            section: user.section || 'N/A',
            check_in_time: activeLog.check_in_time,
            visit_reason: activeLog.visit_reason
        });
    } else {
        return res.json({ 
            status: 'success', 
            role: 'student', 
            intent: 'check-in', 
            user_id: user.id,
            name: user.name || 'Student',
            grade: user.grade || 'N/A',
            section: user.section || 'N/A'
        }); 
    }
});

// 2. Check-in: Create a library log entry
app.post('/api/check-in', async (req, res) => {
    const { user_id, visit_reason, user_type } = req.body;

    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required.' });
    }

    try {
        const today = new Date().toLocaleDateString('sv');
        const now = new Date();
        
        // Format time as HH:MM:SS
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const checkInTime = `${hours}:${minutes}:${seconds}`;
        const normalizedUserType = user_type === 'stakeholder' ? 'stakeholder' : (user_type === 'faculty' ? 'faculty' : 'student');
        
        console.log('[CHECKIN] Formatted checkInTime:', checkInTime);
        
        let insertPayload = {
            user_id,
            visit_reason,
            user_type: normalizedUserType,
            action_date: today,
            check_in_time: checkInTime
        };

        let { data, error } = await supabase
            .from('library_logs')
            .insert([insertPayload]);

        if (error && /check|constraint|user_type/i.test(error.message)) {
            console.warn('[CHECKIN] Primary insert failed, retrying with fallback user_type:', error.message);
            insertPayload = { ...insertPayload, user_type: normalizedUserType === 'stakeholder' ? 'student' : normalizedUserType };
            ({ data, error } = await supabase.from('library_logs').insert([insertPayload]));
        }

        if (error) return res.status(500).json({ error: error.message });

        res.json({ message: 'Checked in successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Check-out: Update check-out time
app.post('/api/check-out', async (req, res) => {
    const { log_id, books } = req.body;

    if (!log_id) {
        return res.status(400).json({ error: 'Log ID is required.' });
    }

    try {
        console.log('[CHECKOUT] Received log_id:', log_id);
        console.log('[CHECKOUT] Received books:', books);
        
        // Extract only HH:MM:SS format for TIME field (local machine time)
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const checkOutTime = `${hours}:${minutes}:${seconds}`;
        
        console.log('[CHECKOUT] Current time object:', now);
        console.log('[CHECKOUT] Formatted checkOutTime:', checkOutTime);
        console.log('[CHECKOUT] About to update library_logs with:', { check_out_time: checkOutTime });
        
        const { data: logData, error: logError } = await supabase
            .from('library_logs')
            .select('user_id, user_type, action_date')
            .eq('id', log_id)
            .single();

        if (logError) {
            console.error('[CHECKOUT ERROR] Failed to fetch log:', logError);
            return res.status(500).json({ error: logError.message });
        }

        const { error } = await supabase
            .from('library_logs')
            .update({ check_out_time: checkOutTime })
            .eq('id', log_id);

        if (error) {
            console.error('[CHECKOUT ERROR]', error);
            return res.status(500).json({ error: error.message });
        }

        // Record books if they were provided during check-out
        if (books && books.length > 0 && logData) {
            console.log('[CHECKOUT] Recording', books.length, 'books for checkout');
            
            const bookRecords = books.map(accession => ({
                user_id: logData.user_id,
                user_type: logData.user_type,
                book_accession: accession,
                action_date: logData.action_date,
                time_read: checkOutTime,
                session_type: 'checkout_return'
            }));
            
            const { error: booksError } = await supabase
                .from('reading_sessions')
                .insert(bookRecords);
            
            if (booksError) {
                console.error('[CHECKOUT] Error recording books:', booksError);
                // Don't fail check-out if books fail to record
            }
        }

        console.log('[CHECKOUT] ✅ Success!');
        res.json({ message: 'Checked out successfully' });
    } catch (error) {
        console.error('[CHECKOUT CATCH]', error);
        res.status(500).json({ error: error.message });
    }
});

// 3.5. Get current logged-in users (checked in but not checked out today)
app.get('/api/current-users', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString('sv');
        console.log(`[DEBUG] Fetching users for date: ${today}`);

        // Step 1: Get all active logs for today (including user_type)
        const { data: activeUsers, error: logsError } = await supabase
            .from('library_logs')
            .select('id, user_id, check_in_time, visit_reason, user_type')
            .eq('action_date', today)
            .is('check_out_time', null)
            .order('check_in_time', { ascending: false });

        console.log(`[DEBUG] Logs query error: ${logsError ? logsError.message : 'none'}`);
        console.log(`[DEBUG] Active logs found: ${activeUsers ? activeUsers.length : 0}`);

        if (logsError) {
            console.error('[ERROR] Failed to fetch logs:', logsError);
            return res.status(500).json({ error: logsError.message });
        }

        if (!activeUsers || activeUsers.length === 0) {
            console.log('[DEBUG] No active users for today');
            return res.json({ count: 0, users: [] });
        }

        // Step 2: Resolve user roles from the users table so stakeholder check-ins still appear correctly even when the log fallback stored them as student
        const userIds = [...new Set(activeUsers.map(log => log.user_id).filter(Boolean))];
        const studentIds = [];
        const facultyIds = [];
        const stakeholderIds = [];
        const userProfileMap = {};

        if (userIds.length > 0) {
            const { data: userProfiles, error: userProfilesError } = await supabase
                .from('users')
                .select('id, role, name, student_id, grade, section, sex, birthdate, age')
                .in('id', userIds);

            if (userProfilesError) {
                console.error('[ERROR] Failed to fetch user profiles:', userProfilesError);
                return res.status(500).json({ error: userProfilesError.message });
            }

            (userProfiles || []).forEach(user => {
                userProfileMap[user.id] = {
                    ...user,
                    user_type: user.role === 'stakeholder' ? 'stakeholder' : 'student'
                };
            });
        }

        activeUsers.forEach(log => {
            if (log.user_type === 'faculty') {
                facultyIds.push(log.user_id);
                return;
            }

            const profile = userProfileMap[log.user_id];
            if (profile?.user_type === 'stakeholder') {
                stakeholderIds.push(log.user_id);
            } else {
                studentIds.push(log.user_id);
            }
        });

        const uniqueStudentIds = [...new Set(studentIds.filter(Boolean))];
        const uniqueFacultyIds = [...new Set(facultyIds.filter(Boolean))];
        const uniqueStakeholderIds = [...new Set(stakeholderIds.filter(Boolean))];
        
        console.log(`[DEBUG] Student IDs: ${uniqueStudentIds.join(', ')}`);
        console.log(`[DEBUG] Faculty IDs: ${uniqueFacultyIds.join(', ')}`);
        console.log(`[DEBUG] Stakeholder IDs: ${uniqueStakeholderIds.join(', ')}`);

        // Step 3: Fetch student data
        const studentMap = {};
        if (uniqueStudentIds.length > 0) {
            const { data: students, error: studentsError } = await supabase
                .from('users')
                .select('id, name, student_id, grade, section, sex, birthdate, age')
                .in('id', uniqueStudentIds);

            if (studentsError) {
                console.error('[ERROR] Failed to fetch students:', studentsError);
                return res.status(500).json({ error: studentsError.message });
            }

            (students || []).forEach(student => {
                studentMap[student.id] = {
                    ...student,
                    user_type: student.role === 'stakeholder' ? 'stakeholder' : 'student'
                };
            });
        }

        // Step 4: Fetch faculty data
        const facultyMap = {};
        if (uniqueFacultyIds.length > 0) {
            const { data: faculty, error: facultyError } = await supabase
                .from('faculty')
                .select('id, name, faculty_id, position, sex, birthdate, age')
                .in('id', uniqueFacultyIds);

            if (facultyError) {
                console.error('[ERROR] Failed to fetch faculty:', facultyError);
                return res.status(500).json({ error: facultyError.message });
            }

            (faculty || []).forEach(fac => {
                facultyMap[fac.id] = { ...fac, user_type: 'faculty' };
            });
        }

        // Step 5: Fetch stakeholder data
        const stakeholderMap = {};
        if (uniqueStakeholderIds.length > 0) {
            const { data: stakeholders, error: stakeholdersError } = await supabase
                .from('users')
                .select('id, name, student_id, grade, section, sex, birthdate, age')
                .in('id', uniqueStakeholderIds);

            if (stakeholdersError) {
                console.error('[ERROR] Failed to fetch stakeholders:', stakeholdersError);
                return res.status(500).json({ error: stakeholdersError.message });
            }

            (stakeholders || []).forEach(stakeholder => {
                stakeholderMap[stakeholder.id] = { ...stakeholder, user_type: 'stakeholder' };
            });
        }

        // Step 6: Fetch books from reading_sessions for each user
        const allUserIds = [...uniqueStudentIds, ...uniqueFacultyIds, ...uniqueStakeholderIds];
        const userBooksMap = {};
        if (allUserIds.length > 0) {
            const { data: readings, error: readingsError } = await supabase
                .from('reading_sessions')
                .select('user_id, user_type, book_accession')
                .in('user_id', allUserIds)
                .eq('action_date', today);

            if (!readingsError && readings && readings.length > 0) {
                readings.forEach(reading => {
                    const key = `${reading.user_type === 'faculty' ? 'faculty' : 'user'}:${reading.user_id}`;
                    if (!userBooksMap[key]) {
                        userBooksMap[key] = [];
                    }
                    userBooksMap[key].push(reading.book_accession);
                });
            }
        }

        // Step 7: Combine the data (faculty ids overlap users ids, so look up by type)
        const formattedUsers = activeUsers.map(log => {
            const isFaculty = log.user_type === 'faculty';
            const userData = (isFaculty ? facultyMap[log.user_id] : (stakeholderMap[log.user_id] || studentMap[log.user_id])) || {};
            return {
                log_id: log.id,
                user_id: log.user_id,
                name: userData.name || 'Unknown',
                student_id: userData.student_id || 'N/A',
                faculty_id: userData.faculty_id || 'N/A',
                grade: userData.grade || 'N/A',
                section: userData.section || userData.organization || 'N/A',
                organization: userData.section || userData.organization || 'N/A',
                position: userData.grade || userData.position || 'N/A',
                sex: userData.sex || 'N/A',
                birthdate: userData.birthdate || 'N/A',
                age: userData.age || 'N/A',
                user_type: userData.user_type || userData.role || log.user_type || 'student',
                check_in_time: log.check_in_time,
                visit_reason: log.visit_reason,
                books: userBooksMap[`${isFaculty ? 'faculty' : 'user'}:${log.user_id}`] || []
            };
        });

        console.log(`[DEBUG] Formatted users:`, formattedUsers);

        res.json({ 
            count: formattedUsers.length,
            users: formattedUsers 
        });
    } catch (error) {
        console.error('[ERROR] Catch block error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 4. Admin: Add a new student
app.post('/api/admin/add-student', async (req, res) => {
    const { student_id, name, grade, section, organization, session, adviser, address, contact_number, sex, birthdate, age } = req.body;
    const normalizedBirthdate = birthdate && String(birthdate).trim() ? birthdate : null;
    const normalizedAge = age !== undefined && age !== null && String(age).trim() !== '' ? age : null;

    if (!student_id || !name) {
        return res.status(400).json({ error: 'Student ID and Name are required.' });
    }

    const { data, error } = await supabase
        .from('users')
        .insert([{ student_id: student_id, name, grade, section, organization, session, adviser, address, contact_number, sex, birthdate: normalizedBirthdate, age: normalizedAge, password: 'NOT_REQUIRED', role: 'student' }]);

    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'This Student ID is already registered.' });
        }
        if (error.message && /column|schema cache|Could not find/i.test(error.message)) {
            return res.status(500).json({ error: 'The student table is missing new profile columns. Please run the SQL migration in SUPABASE_SETUP.sql first.' });
        }
        return res.status(500).json({ error: error.message });
    }

    res.json({ message: `Student ${student_id} (${name}) successfully registered!` });
});

// 5. Admin: Get all students
app.get('/api/admin/students', async (req, res) => {
    try {
        const { data: students, error } = await fetchAll(() => supabase
            .from('users')
            .select('*')
            .eq('role', 'student')
            .order('created_at', { ascending: false }));

        if (error) return res.status(500).json({ error: error.message });

        res.json({ students });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Admin: Update a student
app.put('/api/admin/students/:id', async (req, res) => {
    const { id } = req.params;
    const studentId = Number(id);
    const { student_id, name, grade, section, organization, session, adviser, address, contact_number, sex, birthdate, age } = req.body;
    const normalizedBirthdate = birthdate && String(birthdate).trim() ? birthdate : null;
    const normalizedAge = age !== undefined && age !== null && String(age).trim() !== '' ? age : null;

    if (!Number.isInteger(studentId)) {
        return res.status(400).json({ error: 'Invalid student ID.' });
    }

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ student_id, name, grade, section, organization, session, adviser, address, contact_number, sex, birthdate: normalizedBirthdate, age: normalizedAge })
            .eq('id', studentId)
            .select('*');

        if (error) {
            if (error.message && /column|schema cache|Could not find/i.test(error.message)) {
                return res.status(500).json({ error: 'The student table is missing new profile columns. Please run the SQL migration in SUPABASE_SETUP.sql first.' });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Student updated successfully', student: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE AN ACTIVITY LOG
app.delete('/api/admin/logs/:id', async (req, res) => {
    const logId = req.params.id;

    try {
        // Change 'activity_logs' to your exact Supabase table name if it is named differently
        const { error } = await supabase
            .from('library_logs') 
            .delete()
            .eq('id', logId);

        if (error) throw error;

        return res.status(200).json({ success: true, message: 'Activity deleted successfully' });
    } catch (error) {
        console.error('Database Error:', error);
        return res.status(500).json({ error: error.message || 'Failed to delete data entry' });
    }
});

app.delete('/api/admin/students/:id', async (req, res) => {
    const studentId = req.params.id;

    try {
        // 1. Delete the student's library history first so the constraint doesn't trip
        // Faculty logs reuse the same user_id numbers, so leave them alone
        const { error: logsError } = await supabase
            .from('library_logs')
            .delete()
            .eq('user_id', studentId)
            .neq('user_type', 'faculty');

        if (logsError) throw logsError;

        // 2. Now that history is clear, safe to delete the student profile
        const { error: studentError } = await supabase
            .from('users')
            .delete()
            .eq('id', studentId);

        if (studentError) throw studentError;

        return res.status(200).json({ success: true, message: 'Student and history cleared successfully' });

    } catch (error) {
        console.error('Delete failure:', error);
        return res.status(500).json({ error: error.message || 'Failed to remove student' });
    }
});

// Get single student by ID (for library card export)
app.get('/api/admin/students/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data: student, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        res.json({ student });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// One line of a library card: catalog call number/author/title, a due date, and remarks in words
function toCardRecord(record, book, resource) {
    const due_date = record.due_date || record.return_date || (record.borrow_date ? addDays(record.borrow_date, LOAN_DAYS) : '');
    const remarks = record.status === 'returned'
        ? ({ Damaged: 'Returned Damaged', 'Good Condition': 'Returned in Good Condition' }[record.return_condition] || 'Returned')
        : record.status === 'borrowed' ? (record.renewed_from ? 'Renewal - On loan' : 'On loan')
        : record.status === 'renewed' ? 'Renewed'
        : (record.status || '');
    const isPrint = record.item_category === 'print';
    return {
        ...record,
        item_title: (isPrint && book?.title) || record.item_title, // the title typed at the kiosk is sometimes wrong
        call_number: isPrint ? (book?.call_number || '') : (record.item_category === 'non-print' ? (resource?.resource_code || '') : ''),
        author: isPrint ? (book?.author || '') : '',
        due_date,
        return_condition: record.return_condition || '',
        remarks
    };
}

// Card lines for many borrow records, looking the catalog up in chunks instead of once per record
async function toCardRecords(records) {
    const codes = [...new Set(records.map(r => r.item_code).filter(Boolean))];
    const lookup = async (table, column, columns) => {
        const rows = [];
        for (let i = 0; i < codes.length; i += 200) {
            const { data, error } = await supabase.from(table).select(columns).in(column, codes.slice(i, i + 200));
            if (error) throw error;
            rows.push(...data);
        }
        return rows;
    };
    const [books, resources] = await Promise.all([
        lookup('books', 'accession_number', 'accession_number, call_number, author, title'),
        lookup('non_print_resources', 'resource_code', 'resource_code')
    ]);
    const bookMap = new Map(books.map(b => [b.accession_number, b]));
    const resourceMap = new Map(resources.map(r => [r.resource_code, r]));
    return records.map(r => toCardRecord(r, bookMap.get(r.item_code), resourceMap.get(r.item_code)));
}

// Get borrowing records for a student (for library card export)
app.get('/api/admin/student-borrow-records/:studentId', async (req, res) => {
    const { studentId } = req.params;
    try {
        const { data: records, error } = await supabase
            .from('borrow_records')
            .select('*')
            .eq('student_id', studentId)
            .order('borrow_date', { ascending: false })
            .order('borrow_time', { ascending: false });

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ records: await toCardRecords(records || []) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Every library card of one kind at once, only for people with at least one borrow record. ?type=learner|teacher
app.get('/api/admin/library-cards', async (req, res) => {
    const { type } = req.query;
    if (!['learner', 'teacher'].includes(type)) {
        return res.status(400).json({ error: 'type must be learner or teacher.' });
    }
    const isTeacher = type === 'teacher';
    try {
        const [peopleResult, recordsResult] = await Promise.all([
            isTeacher
                ? fetchAll(() => supabase.from('faculty').select('faculty_id, employee_no, name, address, contact_number, email'))
                : fetchAll(() => supabase.from('users').select('student_id, name, address, contact_number, grade, section, adviser').eq('role', 'student')),
            fetchAll(() => supabase.from('borrow_records').select('*').order('borrow_date', { ascending: false }).order('borrow_time', { ascending: false }))
        ]);
        if (peopleResult.error) throw peopleResult.error;
        if (recordsResult.error) throw recordsResult.error;

        const idOf = person => isTeacher ? person.faculty_id : person.student_id;
        const people = new Map(peopleResult.data.map(p => [idOf(p), p]));
        const lines = await toCardRecords(recordsResult.data.filter(r => people.has(r.student_id)));

        const cards = new Map();
        lines.forEach(line => {
            if (!cards.has(line.student_id)) cards.set(line.student_id, { person: people.get(line.student_id), records: [] });
            cards.get(line.student_id).records.push(line);
        });
        res.json({ cards: [...cards.values()].sort((a, b) => (a.person.name || '').localeCompare(b.person.name || '')) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== FACULTY ENDPOINTS ==========

// Add Faculty
app.post('/api/admin/add-faculty', async (req, res) => {
    const { faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate, age } = req.body;

    if (!faculty_id || !employee_no || !name) {
        return res.status(400).json({ error: 'Faculty Library ID, Employee Number, and Name are required.' });
    }

    const normalizedBirthdate = birthdate && String(birthdate).trim() ? birthdate : null;
    const normalizedAge = age !== undefined && age !== '' && age !== null ? Number(age) : null;

    console.log('[ADD-FACULTY] payload:', { faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate: normalizedBirthdate, age: normalizedAge });
    const { data, error } = await supabase
        .from('faculty')
        .insert([{ faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate: normalizedBirthdate, age: normalizedAge }]);

    console.log('[ADD-FACULTY] supabase response:', { data, error });

    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'This Faculty Library ID is already registered.' });
        }
        return res.status(500).json({ error: error.message });
    }

    res.json({ message: `Faculty ${faculty_id} (${name}) successfully registered!`, data });
});

// Get all faculty
app.get('/api/admin/faculty', async (req, res) => {
    try {
        const { data: faculty, error } = await supabase
            .from('faculty')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ faculty });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update Faculty
app.put('/api/admin/faculty/:id', async (req, res) => {
    const { id } = req.params;
    const { faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate, age } = req.body;

    try {
        const normalizedBirthdate = birthdate && String(birthdate).trim() ? birthdate : null;
        const normalizedAge = age !== undefined && age !== '' && age !== null ? Number(age) : null;

        console.log('[UPDATE-FACULTY] id:', id, 'payload:', { faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate: normalizedBirthdate, age: normalizedAge });
        const { data, error } = await supabase
            .from('faculty')
            .update({ faculty_id, employee_no, name, position, subject_area, grade_level, sex, address, contact_number, email, birthdate: normalizedBirthdate, age: normalizedAge })
            .eq('id', id);

        console.log('[UPDATE-FACULTY] supabase response:', { data, error });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ message: 'Faculty updated successfully', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete Faculty
app.delete('/api/admin/faculty/:id', async (req, res) => {
    const facultyId = req.params.id;

    try {
        // Delete faculty's library logs first
        const { error: logsError } = await supabase
            .from('library_logs')
            .delete()
            .eq('user_id', facultyId)
            .eq('user_type', 'faculty');

        if (logsError) throw logsError;

        // Delete the faculty profile
        const { error: facultyError } = await supabase
            .from('faculty')
            .delete()
            .eq('id', facultyId);

        if (facultyError) throw facultyError;

        return res.status(200).json({ success: true, message: 'Faculty and history cleared successfully' });

    } catch (error) {
        console.error('Delete failure:', error);
        return res.status(500).json({ error: error.message || 'Failed to remove faculty' });
    }
});

// 7a. Get all stakeholder profiles
app.get('/api/admin/stakeholders', async (req, res) => {
    try {
        const { data: stakeholders, error } = await supabase
            .from('users')
            .select('*')
            .eq('role', 'stakeholder')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ stakeholders: stakeholders || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7b. Add a stakeholder profile
app.post('/api/admin/add-stakeholder', async (req, res) => {
    const { stakeholder_id, name, organization, position, contact_number, email, sex, address, birthdate, age } = req.body;

    if (!stakeholder_id || !name) {
        return res.status(400).json({ error: 'Stakeholder ID and name are required.' });
    }

    try {
        const { data, error } = await supabase
            .from('users')
            .insert([{
                student_id: stakeholder_id,
                name,
                role: 'stakeholder',
                section: organization || null,
                grade: position || null,
                contact_number: contact_number || null,
                sex: sex || null,
                address: address || null,
                birthdate: birthdate || null,
                age: age !== undefined && age !== '' && age !== null ? Number(age) : null,
                password: 'NOT_REQUIRED'
            }]);

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ error: 'This stakeholder ID is already registered.' });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: `Stakeholder ${stakeholder_id} (${name}) successfully registered!`, data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7c. Update a stakeholder profile
app.put('/api/admin/stakeholders/:id', async (req, res) => {
    const { id } = req.params;
    const { stakeholder_id, name, organization, position, contact_number, email, sex, address, birthdate, age } = req.body;

    try {
        const { data, error } = await supabase
            .from('users')
            .update({
                student_id: stakeholder_id,
                name,
                section: organization,
                grade: position,
                contact_number,
                sex,
                address,
                birthdate: birthdate || null,
                age: age !== undefined && age !== '' && age !== null ? Number(age) : null
            })
            .eq('id', id)
            .eq('role', 'stakeholder');

        if (error) {
            if (error.message && /column|schema cache|Could not find/i.test(error.message)) {
                return res.status(500).json({ error: 'The users table is missing stakeholder columns. Please run the SQL migration first.' });
            }
            return res.status(500).json({ error: error.message });
        }

        res.json({ message: 'Stakeholder updated successfully', data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7d. Delete a stakeholder profile
app.delete('/api/admin/stakeholders/:id', async (req, res) => {
    const stakeholderId = req.params.id;

    try {
        const { error: logsError } = await supabase
            .from('library_logs')
            .delete()
            .eq('user_id', stakeholderId)
            .neq('user_type', 'faculty');

        if (logsError) throw logsError;

        const { error: stakeholderError } = await supabase
            .from('users')
            .delete()
            .eq('id', stakeholderId)
            .eq('role', 'stakeholder');

        if (stakeholderError) throw stakeholderError;

        return res.status(200).json({ success: true, message: 'Stakeholder and history cleared successfully' });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to remove stakeholder' });
    }
});

// 8. Admin: Get analytics data (Fixed Local Time Implementation)
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString('sv');
        const thisMonth = today.substring(0, 7);
        const [year, month] = thisMonth.split('-').map(Number);
        const nextMonthStart = new Date(year, month, 1).toLocaleDateString('sv'); // month is 1-based, so this is next month

        // Total students count
        const { count: totalStudents, error: err1 } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'student');

        // Today's check-ins count
        const { count: todayCheckins, error: err2 } = await supabase
            .from('library_logs')
            .select('*', { count: 'exact', head: true })
            .eq('action_date', today);

        // Active sessions (checked in but not checked out yet)
        const { count: activeSessions, error: err3 } = await supabase
            .from('library_logs')
            .select('*', { count: 'exact', head: true })
            .eq('action_date', today)
            .is('check_out_time', null);

        // Today's check-outs count
        const { count: todayCheckouts, error: err4 } = await supabase
            .from('library_logs')
            .select('*', { count: 'exact', head: true })
            .eq('action_date', today)
            .not('check_out_time', 'is', null);

        // Total visits for the current month
        const { count: monthVisits, error: err5 } = await supabase
            .from('library_logs')
            .select('*', { count: 'exact', head: true })
            .gte('action_date', `${thisMonth}-01`)
            .lt('action_date', nextMonthStart);

        // Fetch logs for the last 7 days to build the chart
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const startDateStr = sevenDaysAgo.toLocaleDateString('sv');

        const { data: chartLogs, error: err6 } = await fetchAll(() => supabase
            .from('library_logs')
            .select('action_date')
            .gte('action_date', startDateStr)
            .lte('action_date', today));

        // Loop backward to build an organized array of the last 7 calendar days
        const weeklyChartData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toLocaleDateString('sv'); 
            const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });

            const count = chartLogs ? chartLogs.filter(log => log.action_date === dateStr).length : 0;

            weeklyChartData.push({
                date: dateStr,
                day: dayLabel,
                visits: count
            });
        }

        res.json({
            total_students: totalStudents || 0,
            today_checkins: todayCheckins || 0,
            active_sessions: activeSessions || 0,
            today_checkouts: todayCheckouts || 0,
            month_visits: monthVisits || 0,
            unique_students: totalStudents || 0, 
            avg_duration: 'N/A',
            chart_data: weeklyChartData 
        });

    } catch (error) {
        console.error("Analytics Route Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 9. Admin: Get activity logs with student and faculty details
// Default: the latest 100. With ?all=1 or ?from=YYYY-MM-DD&to=YYYY-MM-DD: every log in that range (for reports).
app.get('/api/admin/logs', async (req, res) => {
    try {
        const { all, from, to } = req.query;
        const columns = 'id, user_id, user_type, action_date, check_in_time, check_out_time, visit_reason';
        const { data: logs, error } = (all || from || to)
            ? await fetchAll(() => {
                let query = supabase.from('library_logs').select(columns);
                if (from) query = query.gte('action_date', from);
                if (to) query = query.lte('action_date', to);
                return query.order('action_date', { ascending: false }).order('check_in_time', { ascending: false });
            })
            : await supabase
                .from('library_logs')
                .select(columns)
                .order('action_date', { ascending: false })
                .order('check_in_time', { ascending: false })
                .limit(100);

        if (error) return res.status(500).json({ error: error.message });

        // Students and stakeholders live in users; faculty ids are a separate number range
        const userIds = [...new Set(logs.filter(log => log.user_type !== 'faculty').map(log => log.user_id))];
        const facultyIds = [...new Set(logs.filter(log => log.user_type === 'faculty').map(log => log.user_id))];

        const [studentResult, facultyResult] = await Promise.all([
            userIds.length
                ? fetchAll(() => supabase.from('users').select('id, name, student_id').in('id', userIds))
                : Promise.resolve({ data: [], error: null }),
            facultyIds.length
                ? fetchAll(() => supabase.from('faculty').select('id, name, faculty_id').in('id', facultyIds))
                : Promise.resolve({ data: [], error: null })
        ]);

        if (studentResult.error) throw studentResult.error;
        if (facultyResult.error) throw facultyResult.error;

        const studentMap = new Map((studentResult.data || []).map(s => [s.id, s]));
        const facultyMap = new Map((facultyResult.data || []).map(f => [f.id, f]));

        const formattedLogs = logs.map(log => {
            let studentName = 'Unknown';
            if (log.user_type === 'faculty') {
                studentName = facultyMap.get(log.user_id)?.name || `Faculty ${log.user_id}`;
            } else {
                studentName = studentMap.get(log.user_id)?.name || `${log.user_type === 'stakeholder' ? 'Stakeholder' : 'Student'} ${log.user_id}`;
            }

            return {
                id: log.id,
                user_id: log.user_id,
                user_type: log.user_type,
                action_date: log.action_date,
                check_in_time: log.check_in_time,
                check_out_time: log.check_out_time,
                visit_reason: log.visit_reason,
                student_name: studentName
            };
        });

        res.json({ logs: formattedLogs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 10. Admin: Get attendance date history for daily reports
app.get('/api/admin/attendance-dates', async (req, res) => {
    try {
        const { data, error } = await fetchAll(() => supabase
            .from('library_logs')
            .select('action_date')
            .order('action_date', { ascending: false }));

        if (error) throw error;

        const dates = [...new Set((data || [])
            .map(row => row.action_date)
            .filter(value => value && typeof value === 'string' && value.trim() !== ''))];

        res.json({ dates: dates.slice(0, 50) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 11. Admin: Get daily attendance records for a selected date, or every day of ?month=YYYY-MM
app.get('/api/admin/daily-attendance', async (req, res) => {
    try {
        const month = reportMonth(req);
        if (month === null) return res.status(400).json({ error: BAD_MONTH_MESSAGE });
        const date = req.query.date || new Date().toLocaleDateString('sv');
        const columns = 'id, user_id, user_type, action_date, check_in_time, check_out_time, visit_reason';

        const { data: logs, error } = month
            ? await fetchAll(() => inMonth(supabase.from('library_logs').select(columns), month)
                .order('action_date', { ascending: true })
                .order('check_in_time', { ascending: true }))
            : await supabase
                .from('library_logs')
                .select(columns)
                .eq('action_date', date)
                .order('check_in_time', { ascending: true });

        if (error) throw error;

        // Students and stakeholders live in users; faculty ids are a separate number range
        const studentIds = [...new Set((logs || []).filter(log => log.user_type !== 'faculty').map(log => log.user_id))];
        const facultyIds = [...new Set((logs || []).filter(log => log.user_type === 'faculty').map(log => log.user_id))];

        const [studentResult, facultyResult] = await Promise.all([
            studentIds.length
                ? supabase.from('users').select('id, name, grade, section').in('id', studentIds)
                : Promise.resolve({ data: [], error: null }),
            facultyIds.length
                ? supabase.from('faculty').select('id, name, position').in('id', facultyIds)
                : Promise.resolve({ data: [], error: null })
        ]);

        if (studentResult.error) throw studentResult.error;
        if (facultyResult.error) throw facultyResult.error;

        const studentMap = new Map((studentResult.data || []).map(s => [s.id, s]));
        const facultyMap = new Map((facultyResult.data || []).map(f => [f.id, f]));

        const attendance_records = (logs || []).map((log, index) => {
            const student = log.user_type !== 'faculty' ? studentMap.get(log.user_id) : null;
            const faculty = log.user_type === 'faculty' ? facultyMap.get(log.user_id) : null;
            const name = student?.name || faculty?.name || `User ${log.user_id}`;
            const grade_section = student
                ? `${student.grade || ''}${student.grade && student.section ? ' / ' : ''}${student.section || ''}`.trim()
                : faculty?.position || '';

            return {
                id: log.id,
                no: index + 1,
                date: log.action_date,
                name,
                grade_section,
                purpose: log.visit_reason || '',
                user_id: log.user_id,
                user_type: log.user_type,
                action_date: log.action_date,
                check_in_time: log.check_in_time,
                check_out_time: log.check_out_time,
                visit_reason: log.visit_reason || ''
            };
        });

        res.json({ date, month: month || null, attendance_records });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/attendance/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('library_logs')
            .select('id, user_id, user_type, action_date, check_in_time, check_out_time, visit_reason')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;

        const isFaculty = data.user_type === 'faculty';
        const userResult = isFaculty
            ? await supabase.from('faculty').select('id, name, position').eq('id', data.user_id).maybeSingle()
            : await supabase.from('users').select('id, name, grade, section').eq('id', data.user_id).maybeSingle();
        if (userResult.error) throw userResult.error;

        const record = {
            ...data,
            name: userResult.data?.name || `User ${data.user_id}`,
            grade_section: !isFaculty
                ? `${userResult.data?.grade || ''}${userResult.data?.grade && userResult.data?.section ? ' / ' : ''}${userResult.data?.section || ''}`.trim()
                : userResult.data?.position || ''
        };

        res.json({ record });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/attendance', async (req, res) => {
    try {
        const payload = {
            user_id: req.body.user_id ? Number(req.body.user_id) : null,
            user_type: req.body.user_type || 'student',
            action_date: req.body.action_date || new Date().toLocaleDateString('sv'),
            check_in_time: req.body.check_in_time || '00:00:00',
            check_out_time: req.body.check_out_time || null,
            visit_reason: req.body.visit_reason || req.body.purpose || ''
        };

        if (!payload.user_id) {
            return res.status(400).json({ error: 'User ID is required.' });
        }

        const { data, error } = await supabase.from('library_logs').insert([payload]).select('*');
        if (error) throw error;
        res.json({ record: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/attendance/:id', async (req, res) => {
    try {
        const payload = {
            user_id: req.body.user_id ? Number(req.body.user_id) : null,
            user_type: req.body.user_type || 'student',
            action_date: req.body.action_date || new Date().toLocaleDateString('sv'),
            check_in_time: req.body.check_in_time || '00:00:00',
            check_out_time: req.body.check_out_time || null,
            visit_reason: req.body.visit_reason || req.body.purpose || ''
        };

        const { data, error } = await supabase
            .from('library_logs')
            .update(payload)
            .eq('id', req.params.id)
            .select('*');

        if (error) throw error;
        res.json({ record: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/attendance/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('library_logs').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Calendar of Activities
app.get('/api/admin/calendar-activities', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('calendar_activities')
            .select('*')
            .order('activity_date', { ascending: true });

        if (error) return res.status(500).json({ error: error.message });
        res.json({ calendar_activities: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/calendar-activities', async (req, res) => {
    try {
        const payload = {
            activity_date: normalizeCalendarActivityValue(req.body.activity_date || new Date().toISOString()),
            activity_description: req.body.activity_description || '',
            persons_involved: req.body.persons_involved || '',
            status: req.body.status || 'Planned'
        };

        const { data, error } = await supabase.from('calendar_activities').insert([payload]).select('*');
        if (error) throw error;
        res.json({ calendar_activity: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/calendar-activities/:id', async (req, res) => {
    try {
        const payload = {
            activity_date: normalizeCalendarActivityValue(req.body.activity_date || new Date().toISOString()),
            activity_description: req.body.activity_description || '',
            persons_involved: req.body.persons_involved || '',
            status: req.body.status || 'Planned'
        };

        const { data, error } = await supabase
            .from('calendar_activities')
            .update(payload)
            .eq('id', req.params.id)
            .select('*');

        if (error) throw error;
        res.json({ calendar_activity: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/calendar-activities/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('calendar_activities').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BOOKS MANAGEMENT API ==========

// 10. Get all books
app.get('/api/admin/books', async (req, res) => {
    try {
        const { data: books, error } = await fetchAll(() => supabase
            .from('books')
            .select('*')
            .order('created_at', { ascending: false }));

        if (error) return res.status(500).json({ error: error.message });

        res.json({ books: books || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 11. Add a new book
app.post('/api/admin/add-book', async (req, res) => {
    const payload = buildBookRecord({ ...req.body, remarks: req.body?.remarks ?? req.body?.remark ?? req.body?.remarks_text ?? req.body?.notes ?? '' });
    console.log('[ADD-BOOK] Received request body:', req.body);
    console.log('[ADD-BOOK] Built payload:', payload);
    console.log('[ADD-BOOK] Category value:', payload.category);

    if (!payload.accession_number || !payload.call_number || !payload.title || !payload.author) {
        return res.status(400).json({ error: 'Accession Number, Call Number (or DDC No.), Title, and Author are required.' });
    }
    if (!payload.category) {
        return res.status(400).json({ error: INVALID_CATEGORY_MESSAGE });
    }

    try {
        const { data, error } = await supabase
            .from('books')
            .insert([payload])
            .select('*');

        if (error) {
            console.error('[ADD-BOOK] Database error:', error);
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Accession Number already exists. Please use a unique number.' });
            }
            if (isMissingColumnError(error)) {
                const fallbackPayload = {
                    accession_number: payload.accession_number,
                    call_number: payload.call_number,
                    title: payload.title,
                    author: payload.author,
                    category: payload.category,
                    copyright_year: payload.copyright_year,
                    isbn: payload.isbn,
                    remarks: payload.remarks
                };
                const { data: fallbackData, error: fallbackError } = await supabase.from('books').insert([fallbackPayload]).select('*');
                if (fallbackError) {
                    console.error('[ADD-BOOK] Fallback insert failed:', fallbackError);
                    return res.status(500).json({ error: fallbackError.message });
                }
                return res.json({ message: 'Book added successfully with core fields only. Run the database migration to enable metadata columns including remarks.', book: fallbackData });
            }
            return res.status(500).json({ error: error.message });
        }

        console.log('[ADD-BOOK] Book added successfully with data:', data);
        res.json({ message: 'Book added successfully!', book: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 12. Update a book
app.put('/api/admin/books/:id', async (req, res) => {
    const { id } = req.params;
    const payload = buildBookRecord({ ...req.body, remarks: req.body?.remarks ?? req.body?.remark ?? req.body?.remarks_text ?? req.body?.notes ?? '' });
    console.log('[UPDATE-BOOK] ID:', id, 'Request body:', req.body);
    console.log('[UPDATE-BOOK] Built payload:', payload);
    console.log('[UPDATE-BOOK] Category value:', payload.category);

    if (!payload.category) {
        return res.status(400).json({ error: INVALID_CATEGORY_MESSAGE });
    }

    try {
        const { data, error } = await supabase
            .from('books')
            .update({
                ...payload,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select('*');

        if (error) {
            console.error('[UPDATE-BOOK] Database error:', error);
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Accession Number already exists.' });
            }
            return res.status(500).json({ error: error.message });
        }

        console.log('[UPDATE-BOOK] Book updated successfully');
        res.json({ message: 'Book updated successfully!', book: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 13. Delete a book
app.delete('/api/admin/books/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { error } = await supabase
            .from('books')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Book deleted successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== NON-PRINT RESOURCES ENDPOINTS ==========

// 15. Get all non-print resources
app.get('/api/admin/non-print-resources', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('non_print_resources')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const resources = (data || []).map(item => ({
            id: item.id,
            code: item.code || item.resource_code || item.resourceCode || '—',
            unit: item.unit || item.units || item.quantity || '—',
            name: item.name || item.title || '—',
            category: item.category || item.resource_type || '—',
            condition: item.condition || item.status || '—',
            description: item.description || ''
        }));

        res.json({ resources });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 16. Add a new non-print resource
app.post('/api/admin/add-non-print-resource', async (req, res) => {
    console.log('[ADD-NONPRINT] body payload:', req.body);
    const resource_code = (req.body.resource_code || req.body.resourceCode || req.body.code || '').toString().trim();
    const unit = (req.body.unit || req.body.units || '').toString().trim();
    const name = (req.body.title || req.body.name || '').toString().trim();
    const category = (req.body.category || req.body.resource_type || '').toString().trim();
    const condition = (req.body.condition || req.body.status || '').toString().trim();

    if (!resource_code || !unit || !name || !category || !condition) {
        console.log('[ADD-NONPRINT] validation failed:', { resource_code, unit, name, category, condition });
        return res.status(400).json({ error: 'Resource code, Unit, Name, Category, and Condition are required.' });
    }

    const insertRow = {
        resource_code,
        title: name,
        unit,
        category,
        condition
    };

    console.log('[ADD-NONPRINT] insert row:', insertRow);

    try {
        const { data, error } = await supabase
            .from('non_print_resources')
            .insert([insertRow]);

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Code already exists. Please use a unique code.' });
            }
            throw error;
        }

        res.json({ message: 'Resource added successfully!', resource: data });
    } catch (error) {
        console.error('[ADD-NONPRINT ERROR]', error);
        res.status(500).json({ error: error.message });
    }
});

// 17. Update a non-print resource
app.put('/api/admin/non-print-resources/:id', async (req, res) => {
    const { id } = req.params;
    const resource_code = (req.body.resource_code || req.body.code || '').trim();
    const unit = (req.body.unit || req.body.units || '').toString().trim();
    const name = (req.body.title || req.body.name || '').trim();
    const category = (req.body.category || req.body.resource_type || '').trim();
    const condition = (req.body.condition || req.body.status || '').trim();

    try {
        const updateRow = {
            resource_code: resource_code || undefined,
            title: name || undefined,
            unit: unit || undefined,
            category: category || undefined,
            condition: condition || undefined,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('non_print_resources')
            .update(updateRow)
            .eq('id', id);

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Code already exists.' });
            }
            throw error;
        }

        res.json({ message: 'Resource updated successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 18. Delete a non-print resource
app.delete('/api/admin/non-print-resources/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { error } = await supabase
            .from('non_print_resources')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Resource deleted successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== INVENTORY & WEEDING REPORTS ==========
app.get('/api/admin/inventory-weeding', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('inventory_weeding_reports')
            .select('*')
            .order('date_of_inventory', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ reports: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/inventory-weeding', async (req, res) => {
    try {
        const payload = buildInventoryWeedingRecord(req.body);
        if (!payload.accession_no || !payload.title || !payload.date_of_inventory) {
            return res.status(400).json({ error: 'Accession No., Title, and Date of Inventory are required.' });
        }

        const { data, error } = await supabase.from('inventory_weeding_reports').insert([payload]).select('*');
        if (error) throw error;
        res.json({ message: 'Inventory report saved successfully.', report: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/admin/inventory-weeding/:id', async (req, res) => {
    try {
        const payload = buildInventoryWeedingRecord(req.body);
        if (!payload.accession_no || !payload.title || !payload.date_of_inventory) {
            return res.status(400).json({ error: 'Accession No., Title, and Date of Inventory are required.' });
        }

        const { data, error } = await supabase
            .from('inventory_weeding_reports')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select('*');

        if (error) throw error;
        if (!data?.length) {
            return res.status(404).json({ error: 'Inventory report not found.' });
        }
        res.json({ message: 'Inventory report updated successfully.', report: data[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin/inventory-weeding/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('inventory_weeding_reports').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ message: 'Inventory report deleted successfully.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== OPAC (public catalog) ==========

// One entry per title with its copies; a copy with an open loan is on loan, every other copy is available
function buildOpacCatalog(books, openLoans) {
    const dueByCode = new Map(openLoans.map(loan => [loan.item_code, loan.due_date]));
    const titles = new Map();
    for (const book of books) {
        // Copies share a book_id; books added before the OPAC import are grouped by title and author instead
        const key = book.book_id || `${book.title}|${book.author}`.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!titles.has(key)) {
            titles.set(key, {
                id: key,
                title: book.title,
                author: book.author || '',
                publisher: book.publisher || '',
                year: book.copyright_year || '',
                isbn: book.isbn || '',
                edition: book.edition || '',
                subject: book.subject || '',
                call_number: book.call_number || book.ddc_no || '',
                section: book.category || '',
                loan_policy: book.loan_policy || '',
                copies: []
            });
        }
        titles.get(key).copies.push({
            accession: book.accession_number,
            copy_no: book.copy_no || '',
            call_number: book.call_number || book.ddc_no || '',
            on_loan: dueByCode.has(book.accession_number),
            due_date: dueByCode.get(book.accession_number) || null
        });
    }

    const byNumber = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
    const list = [...titles.values()].sort((a, b) => byNumber(a.title, b.title));
    list.forEach(t => t.copies.sort((a, b) => byNumber(a.copy_no || a.accession, b.copy_no || b.accession)));
    return list;
}

// shortcut: sends the whole catalog (~1,500 copies) for the kiosk to search in the browser; switch to a
// server-side search with paging if the collection grows past ~10,000 copies.
// Public, so only catalog fields leave the server; who borrowed a copy never does.
app.get('/api/opac/catalog', async (req, res) => {
    try {
        const [{ data: books, error: booksError }, { data: loans, error: loansError }] = await Promise.all([
            fetchAll(() => supabase.from('books').select('*')), // '*' keeps this working before OPAC_INVENTORY_2026.sql adds its columns
            fetchAll(() => supabase.from('borrow_records').select('id, item_code, due_date').eq('item_category', 'print').eq('status', 'borrowed'))
        ]);
        if (booksError || loansError) throw booksError || loansError;
        res.json({ titles: buildOpacCatalog(books, loans) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BORROWING/RETURNING ENDPOINTS ==========

// 18a. Check if a book exists in the database
app.get('/api/check-book-availability/:code', async (req, res) => {
    const { code } = req.params;

    try {
        // Check in books table
        const { data: book, error: bookError } = await supabase
            .from('books')
            .select('id, title, accession_number')
            .eq('accession_number', code)
            .single();

        if (book) {
            return res.json({ available: true, type: 'print', book });
        }

        // Check in non_print_resources table
        const { data: nonPrint, error: npError } = await supabase
            .from('non_print_resources')
            .select('id, title, resource_code')
            .eq('resource_code', code)
            .single();

        if (nonPrint) {
            return res.json({ available: true, type: 'non-print', resource: nonPrint });
        }

        // Book not found
        res.json({ available: false, message: 'Book not found in the library' });
    } catch (error) {
        res.json({ available: false, message: 'Book not found in the library' });
    }
});

// 18b. Get pending returns for a specific student
app.get('/api/student/pending-returns/:student_id', async (req, res) => {
    const { student_id } = req.params;

    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .select('*')
            .eq('student_id', student_id)
            .eq('status', 'borrowed')
            .eq('admin_verified', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ records: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BORROWING/RETURNING ENDPOINTS ==========

// 19. Record a borrow (Student initiates) - Book must exist in database
app.post('/api/borrow', async (req, res) => {
    const { student_id, student_name, section, item_category, item_title, item_code } = req.body;
    
    console.log('[BORROW] Request received:', req.body);
    
    if (!student_id || !student_name || !item_category || !item_title || !item_code) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // First, validate that the book exists in the database
        let bookExists = false;
        
        if (item_category === 'print') {
            const { data: book, error: bookError } = await supabase
                .from('books')
                .select('id')
                .eq('accession_number', item_code.trim())
                .single();
            
            if (book) bookExists = true;
        } else if (item_category === 'non-print') {
            const { data: resource, error: resourceError } = await supabase
                .from('non_print_resources')
                .select('id')
                .eq('resource_code', item_code.trim())
                .single();
            
            if (resource) bookExists = true;
        }

        if (!bookExists) {
            const resourceLabel = item_category === 'non-print' ? 'non-print resource' : 'print resource';
            return res.status(404).json({ error: `${resourceLabel.charAt(0).toUpperCase() + resourceLabel.slice(1)} not found in the library. Please check the identifier.` });
        }

        const { data: activeBorrow, error: activeBorrowError } = await supabase
            .from('borrow_records')
            .select('id')
            .eq('item_code', item_code.trim())
            .eq('item_category', item_category.trim())
            .eq('status', 'borrowed')
            .maybeSingle();

        if (activeBorrowError) throw activeBorrowError;
        if (activeBorrow) {
            return res.status(409).json({ error: 'This item is currently borrowed and cannot be borrowed again until it is returned.' });
        }

        const now = new Date();
        const borrow_date = now.toLocaleDateString('sv'); // YYYY-MM-DD, local like borrow_time
        
        // Format time as HH:MM:SS
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const borrow_time = `${hours}:${minutes}:${seconds}`;
        const due_date = addDays(borrow_date, LOAN_DAYS);

        const { data, error } = await supabase
            .from('borrow_records')
            .insert([{
                student_id: student_id.trim(),
                student_name: student_name.trim(),
                section: section ? section.trim() : '',
                item_category: item_category.trim(),
                item_title: item_title.trim(),
                item_code: item_code.trim(),
                borrow_date,
                borrow_time,
                due_date,
                status: 'borrowed'
            }]);

        if (error) {
            console.error('[BORROW] Database error:', error);
            // Unique index on open borrows (SUPABASE_SETUP.sql) rejects a second copy, e.g. from a double tap
            if (error.code === '23505') {
                return res.status(409).json({ error: 'This item is currently borrowed and cannot be borrowed again until it is returned.' });
            }
            throw error;
        }

        console.log('[BORROW] Record created successfully');
        res.json({ message: 'Borrow recorded successfully!', record: data, due_date });
    } catch (error) {
        console.error('[BORROW] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 21. Get all pending borrows for admin verification
app.get('/api/admin/pending-borrows', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .select('*')
            .eq('status', 'borrowed')
            .eq('admin_verified', false)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ records: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 21. Get all borrow records for admin
app.get('/api/admin/all-borrows', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ records: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 22. Admin verifies a borrow
app.put('/api/admin/verify-borrow/:id', async (req, res) => {
    const { id } = req.params;
    const { due_date } = req.body || {};

    try {
        const updatePayload = {
            admin_verified: true,
            updated_at: new Date().toISOString()
        };

        if (due_date) {
            updatePayload.due_date = due_date;
        }

        const { data, error } = await supabase
            .from('borrow_records')
            .update(updatePayload)
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Borrow verified successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 23. Record a return (Student initiates return)
app.post('/api/return-item', async (req, res) => {
    const { student_id, item_code } = req.body;
    
    console.log('[RETURN] Request received:', req.body);
    
    if (!student_id || !item_code) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Find the borrow record that has been verified by admin (in pending returns)
        const { data: borrowRecord, error: findError } = await supabase
            .from('borrow_records')
            .select('*')
            .eq('student_id', student_id)
            .eq('item_code', item_code)
            .eq('status', 'borrowed')
            .eq('admin_verified', true)  // Only allow return if admin verified
            .single();

        if (findError || !borrowRecord) {
            return res.status(404).json({ error: 'This book is not in your pending returns list. Admin must verify the borrow first.' });
        }

        // Update with return information
        const now = new Date();
        const return_date = now.toLocaleDateString('sv');
        
        // Format time as HH:MM:SS
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const return_time = `${hours}:${minutes}:${seconds}`;

        const { data, error } = await supabase
            .from('borrow_records')
            .update({
                return_date,
                return_time,
                status: 'returned',
                updated_at: new Date().toISOString()
            })
            .eq('id', borrowRecord.id);

        if (error) {
            console.error('[RETURN] Database error:', error);
            throw error;
        }

        console.log('[RETURN] Return recorded successfully');
        res.json({ 
            message: 'Return recorded successfully!',
            record: {
                item_title: borrowRecord.item_title,
                item_code: borrowRecord.item_code,
                borrow_date: borrowRecord.borrow_date,
                borrow_time: borrowRecord.borrow_time,
                return_date,
                return_time
            }
        });
    } catch (error) {
        console.error('[RETURN] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 24. Admin gets everything still to be returned: verified loans still out, plus items returned at the kiosk
// whose condition has not been checked yet (those come first, then loans by due date, most overdue first)
app.get('/api/admin/pending-returns', async (req, res) => {
    try {
        const { data, error } = await fetchAll(() => supabase
            .from('borrow_records')
            .select('*')
            .in('status', ['borrowed', 'returned']));

        if (error) throw error;

        const pendingReturns = data
            .filter(rec => rec.status === 'borrowed' ? rec.admin_verified : !(rec.return_condition || '').toString().trim())
            .sort((a, b) => (a.status === 'returned' ? 0 : 1) - (b.status === 'returned' ? 0 : 1)
                || String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31')));

        res.json({ records: pendingReturns });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// A new loan is due this many days after it is borrowed; the admin can still change it when verifying
const LOAN_DAYS = 3;

function addDays(date, days) {
    const result = new Date(`${date}T00:00:00Z`);
    result.setUTCDate(result.getUTCDate() + days);
    return result.toISOString().slice(0, 10);
}

// New due date for a renewal, counted from the date the item was due: 3 days for learners, 5 for faculty
function renewalDueDate(dueDate, isFaculty) {
    return addDays(dueDate, isFaculty ? 5 : 3);
}

const RENEWAL_COLUMN_SQL = 'ALTER TABLE borrow_records ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES borrow_records(id) ON DELETE SET NULL;';

// Auto-renew: closes the current loan as "renewed" and adds a new record for the same borrower and item
app.post('/api/admin/renew-borrow/:id', async (req, res) => {
    try {
        const { data: loan, error: findError } = await supabase.from('borrow_records').select('*').eq('id', req.params.id).maybeSingle();
        if (findError) throw findError;
        if (!loan) return res.status(404).json({ error: 'Borrow record not found.' });
        if (loan.status !== 'borrowed') return res.status(400).json({ error: 'Only items still on loan can be renewed.' });
        if (!loan.admin_verified || !loan.due_date) return res.status(400).json({ error: 'Verify this borrow and set its due date before renewing it.' });

        // Renewals are linked through borrow_records.renewed_from, a column that has to be added once in Supabase
        const { error: columnError } = await supabase.from('borrow_records').select('renewed_from').limit(1);
        if (columnError) return res.status(500).json({ error: `Renewals need one database change first. In the Supabase SQL Editor run: ${RENEWAL_COLUMN_SQL}` });

        const { data: facultyRow, error: facultyError } = await supabase.from('faculty').select('id').eq('faculty_id', loan.student_id).maybeSingle();
        if (facultyError) throw facultyError;
        const isFaculty = Boolean(facultyRow);
        const now = new Date();

        // Close the current loan first: only one open loan per item is allowed
        const { data: closed, error: closeError } = await supabase.from('borrow_records')
            .update({ status: 'renewed', updated_at: now.toISOString() })
            .eq('id', loan.id)
            .eq('status', 'borrowed')
            .select('id');
        if (closeError) throw closeError;
        if (!closed.length) return res.status(409).json({ error: 'This loan was already renewed or returned.' });

        const renewal = {
            student_id: loan.student_id,
            student_name: loan.student_name,
            section: loan.section,
            item_category: loan.item_category,
            item_title: loan.item_title,
            item_code: loan.item_code,
            borrow_date: loan.due_date, // the renewal period starts on the date the item was due
            borrow_time: now.toTimeString().slice(0, 8),
            due_date: renewalDueDate(loan.due_date, isFaculty),
            status: 'borrowed',
            admin_verified: true,
            renewed_from: loan.id
        };
        const { data: created, error: insertError } = await supabase.from('borrow_records').insert([renewal]).select('*');
        if (insertError) {
            // Reopen the original loan so the borrower never ends up with no open record
            await supabase.from('borrow_records').update({ status: 'borrowed' }).eq('id', loan.id);
            throw insertError;
        }

        res.json({ message: `Renewed for ${isFaculty ? 5 : 3} days. New due date: ${renewal.due_date}.`, record: created?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin records a borrowing by hand (e.g. one from an earlier date); same lookups as the kiosk, already verified
app.post('/api/admin/manual-borrow', async (req, res) => {
    const { borrower_type, borrower_id, item_category, item_code, borrow_date, due_date } = req.body || {};
    const borrowerId = String(borrower_id || '').trim();
    const code = String(item_code || '').trim();
    const today = new Date().toLocaleDateString('sv');
    const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

    if (!['student', 'faculty'].includes(borrower_type)) return res.status(400).json({ error: 'Choose whether the borrower is a student or faculty.' });
    if (!['print', 'non-print'].includes(item_category)) return res.status(400).json({ error: 'Choose whether the resource is print or non-print.' });
    if (!borrowerId || !code) return res.status(400).json({ error: 'Borrower ID and accession number are required.' });
    if (!isDate(borrow_date) || borrow_date > today) return res.status(400).json({ error: 'Choose a borrow date that is today or earlier.' });
    if (!isDate(due_date) || due_date < borrow_date) return res.status(400).json({ error: 'Choose a due date on or after the borrow date.' });

    try {
        const isFaculty = borrower_type === 'faculty';
        const isPrint = item_category === 'print';
        const [{ data: borrower, error: borrowerError }, { data: found, error: itemError }] = await Promise.all([
            isFaculty
                ? supabase.from('faculty').select('name').eq('faculty_id', borrowerId).maybeSingle()
                : supabase.from('users').select('name, section').eq('student_id', borrowerId).eq('role', 'student').maybeSingle(),
            isPrint
                ? supabase.from('books').select('title').eq('accession_number', code).maybeSingle()
                : supabase.from('non_print_resources').select('title').eq('resource_code', code).maybeSingle()
        ]);
        if (borrowerError || itemError) throw borrowerError || itemError;
        if (!borrower) return res.status(404).json({ error: `No ${isFaculty ? 'faculty member' : 'student'} has the ID ${borrowerId}.` });
        if (!found) return res.status(404).json({ error: `No ${isPrint ? 'print book' : 'non-print resource'} has the code ${code}.` });
        const item = { category: item_category, title: found.title };

        const { data: openLoans, error: openError } = await supabase.from('borrow_records')
            .select('student_name')
            .eq('item_code', code)
            .eq('item_category', item.category)
            .eq('status', 'borrowed')
            .limit(1);
        if (openError) throw openError;
        if (openLoans.length) return res.status(409).json({ error: `This item is still on loan to ${openLoans[0].student_name}. Record its return first.` });

        const { data, error } = await supabase.from('borrow_records').insert([{
            student_id: borrowerId,
            student_name: borrower.name,
            section: isFaculty ? 'Faculty' : (borrower.section || ''),
            item_category: item.category,
            item_title: item.title,
            item_code: code,
            borrow_date,
            borrow_time: new Date().toTimeString().slice(0, 8),
            due_date,
            status: 'borrowed',
            admin_verified: true
        }]).select('*');
        if (error) {
            if (error.code === '23505') return res.status(409).json({ error: 'This item is currently borrowed and cannot be borrowed again until it is returned.' });
            throw error;
        }

        res.json({ message: `Recorded: "${item.title}" borrowed by ${borrower.name}.`, record: data?.[0] || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CSV with a BOM so Excel shows names like "Peñaranda" correctly
function toCsv(header, rows) {
    const cell = value => `"${(value ?? '').toString().replace(/"/g, '""')}"`;
    return '﻿' + [header.map(cell).join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n');
}

function sendCsv(res, filename, csv) {
    res.setHeader('Content-disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
}

function returnRemarks(rec) {
    if (rec.status === 'renewed') return 'Renewed';
    if (rec.status !== 'returned') return '';
    if (rec.return_condition === 'Damaged') return 'Returned Damaged';
    if (rec.return_condition === 'Good Condition') return 'Returned in Good Condition';
    return 'Returned';
}

// Export all students as CSV
app.get('/api/admin/export/students', async (req, res) => {
    try {
        const { data: students, error } = await fetchAll(() => supabase
            .from('users')
            .select('student_id,name,grade,section,session,adviser,address,contact_number,sex,birthdate,age')
            .eq('role', 'student')
            .order('name', { ascending: true }));

        if (error) throw error;

        const columns = ['student_id', 'name', 'grade', 'section', 'session', 'adviser', 'address', 'contact_number', 'sex', 'birthdate', 'age'];
        sendCsv(res, 'students.csv', toCsv(columns, students.map(s => columns.map(c => s[c]))));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rows for the learner or teacher borrower's log. Print items only: non-print has its own log.
async function getBorrowerLogRows(kind) {
    const isTeacher = kind === 'teacher';
    const { data: borrowers, error: borrowersError } = isTeacher
        ? await fetchAll(() => supabase.from('faculty').select('faculty_id, position, subject_area, grade_level'))
        : await fetchAll(() => supabase.from('users').select('student_id, grade, section').eq('role', 'student'));
    if (borrowersError) throw borrowersError;
    // The faculty list also holds Non-Teaching staff; the teacher log is for teachers only
    const eligible = isTeacher ? borrowers.filter(b => !/non[-\s]?teaching/i.test(b.position || '')) : borrowers;
    const borrowerMap = new Map(eligible.map(b => [isTeacher ? b.faculty_id : b.student_id, b]));

    const [{ data: records, error: recordsError }, { data: books, error: booksError }] = await Promise.all([
        fetchAll(() => supabase.from('borrow_records').select('*').eq('item_category', 'print').order('borrow_date', { ascending: true })),
        fetchAll(() => supabase.from('books').select('accession_number, title, author, copyright_year'))
    ]);
    if (recordsError) throw recordsError;
    if (booksError) throw booksError;
    const bookMap = new Map(books.map(b => [b.accession_number, b]));

    return records.filter(rec => borrowerMap.has(rec.student_id)).map(rec => {
        const borrower = borrowerMap.get(rec.student_id);
        const book = bookMap.get(rec.item_code) || {};
        return {
            date_borrowed: rec.borrow_date || '',
            borrower_name: rec.student_name || '',
            subject_area: isTeacher ? borrower.subject_area || '' : '',
            grade_level: isTeacher ? borrower.grade_level || '' : [borrower.grade, borrower.section].filter(Boolean).join(' - '),
            author: book.author || '',
            title: book.title || rec.item_title || '', // the title typed at the kiosk is sometimes wrong
            copyright: book.copyright_year ? String(book.copyright_year) : '',
            due_date: rec.due_date || '',
            date_returned: rec.return_date || '',
            remarks: returnRemarks(rec)
        };
    });
}

const BORROWER_LOG_HEADER = ['Date Borrowed', "Borrower's Name", 'Subject Area', 'Grade Level', 'Author', 'Title', 'Copyright', 'Due Date', 'Signature', 'Date Returned', 'Signature (Returned)', 'Remarks'];
const borrowerLogCsv = rows => toCsv(BORROWER_LOG_HEADER, rows.map(r => [r.date_borrowed, r.borrower_name, r.subject_area, r.grade_level, r.author, r.title, r.copyright, r.due_date, '', r.date_returned, '', r.remarks]));
// The learner log (Annex 2.2) has no Subject Area column, and grade level and section share one column
const LEARNER_LOG_HEADER = ['Date Borrowed', "Borrower's Name", 'Grade Level & Section', 'Author', 'Title', 'Copyright', 'Due Date', 'Signature', 'Date Returned', 'Signature (Returned)', 'Remarks'];
const learnerLogCsv = rows => toCsv(LEARNER_LOG_HEADER, rows.map(r => [r.date_borrowed, r.borrower_name, r.grade_level, r.author, r.title, r.copyright, r.due_date, '', r.date_returned, '', r.remarks]));

// Learner borrower's log: CSV download, and JSON for the PDF/Excel exports
app.get('/api/admin/export/borrowers-log', async (req, res) => {
    try {
        sendCsv(res, 'borrowers_log.csv', learnerLogCsv(await getBorrowerLogRows('learner')));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/export/borrowers-json', async (req, res) => {
    try {
        res.json({ records: await getBorrowerLogRows('learner') });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Teacher borrower's log: same formats
app.get('/api/admin/export/teacher-borrowers-log', async (req, res) => {
    try {
        sendCsv(res, 'teacher_borrowers_log.csv', borrowerLogCsv(await getBorrowerLogRows('teacher')));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/export/teacher-borrowers-json', async (req, res) => {
    try {
        res.json({ records: await getBorrowerLogRows('teacher') });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// School Library Circulation Report for one month, learners only so every section adds up to Total Checkouts.
// ?month=YYYY-MM
app.get('/api/admin/circulation-report', async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return res.status(400).json({ error: 'Choose a month, e.g. 2026-09.' });
        }
        const [year, monthNumber] = month.split('-').map(Number);
        const start = `${month}-01`;
        const end = new Date(year, monthNumber, 0).toLocaleDateString('sv'); // day 0 of next month = last day of this one
        const today = new Date().toLocaleDateString('sv');
        if (start > today) {
            return res.status(400).json({ error: 'That month has not started yet.' });
        }

        const [studentsResult, recordsResult, booksResult] = await Promise.all([
            fetchAll(() => supabase.from('users').select('student_id, grade').eq('role', 'student')),
            // '*' so the report still works before the renewed_from column is added
            fetchAll(() => supabase.from('borrow_records').select('*')),
            fetchAll(() => supabase.from('books').select('accession_number, category'))
        ]);
        for (const result of [studentsResult, recordsResult, booksResult]) {
            if (result.error) throw result.error;
        }

        const gradeOf = new Map(studentsResult.data.map(s => [s.student_id, s.grade]));
        const categoryOf = new Map(booksResult.data.map(b => [b.accession_number, b.category]));
        const learnerRecords = recordsResult.data.filter(r => gradeOf.has(r.student_id));
        const inMonth = r => r.borrow_date >= start && r.borrow_date <= end;
        // A renewal adds a record but is not a new checkout
        const checkouts = learnerRecords.filter(r => inMonth(r) && !r.renewed_from);
        const renewals = learnerRecords.filter(r => inMonth(r) && r.renewed_from).length;

        const byGrade = { 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };
        let otherGrade = 0;
        checkouts.forEach(r => {
            const grade = Number(String(gradeOf.get(r.student_id) || '').match(/\d{1,2}/)?.[0]);
            if (grade in byGrade) byGrade[grade]++;
            else otherGrade++;
        });

        const byCategory = {};
        checkouts.filter(r => r.item_category === 'print').forEach(r => {
            const category = categoryOf.get(r.item_code) || 'Uncategorized';
            byCategory[category] = (byCategory[category] || 0) + 1;
        });

        // Overdue = due date passed while the item was still out: at the close of the month,
        // or right now for the current month (which has not closed yet)
        const monthClosed = end < today;
        const isOverdue = r => {
            // A renewed loan was replaced by its renewal record, which carries the due date that counts
            if (!r.due_date || r.borrow_date > end || r.status === 'renewed') return false;
            if (monthClosed) return r.due_date <= end && (!r.return_date || r.return_date > end);
            return r.due_date < today && !r.return_date;
        };

        res.json({
            month,
            start,
            end,
            registered_students: studentsResult.data.length,
            total_checkouts: checkouts.length,
            renewals,
            // Renewing counts as borrowing activity for the learner
            active_borrowers: new Set(learnerRecords.filter(inMonth).map(r => r.student_id)).size,
            overdue_at_month_end: learnerRecords.filter(isOverdue).length,
            damaged_returns: learnerRecords.filter(r => r.return_condition === 'Damaged' && r.return_date >= start && r.return_date <= end).length,
            by_grade: byGrade,
            other_grade: otherGrade,
            by_category: Object.entries(byCategory).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
            print: checkouts.filter(r => r.item_category === 'print').length,
            non_print: checkouts.filter(r => r.item_category === 'non-print').length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Return non-print borrowers log as JSON for PDF export in the non-print section
app.get('/api/admin/export/non-print-borrowers-json', async (req, res) => {
    try {
        const { data: adminUsers, error: adminError } = await supabase.from('users').select('student_id').eq('role', 'admin');
        if (adminError) throw adminError;
        const adminIds = new Set(adminUsers.map(a => a.student_id));

        const [{ data: records, error }, { data: resources, error: resourcesError }] = await Promise.all([
            fetchAll(() => supabase.from('borrow_records').select('*').eq('item_category', 'non-print').order('borrow_date', { ascending: true })),
            fetchAll(() => supabase.from('non_print_resources').select('resource_code, category, title'))
        ]);
        if (error) throw error;
        if (resourcesError) throw resourcesError;
        const resourceMap = new Map(resources.map(r => [r.resource_code, r]));

        res.json({
            records: records.filter(rec => !adminIds.has(rec.student_id)).map(rec => {
                const resource = resourceMap.get(rec.item_code) || {};
                return {
                    date_borrowed: rec.borrow_date || '',
                    borrower_name: rec.student_name || '',
                    resource_category: resource.category || 'Others',
                    resource_title: rec.item_title || resource.title || '',
                    resource_code: rec.item_code || '',
                    due_date: rec.due_date || '',
                    date_returned: rec.return_date || '',
                    remarks: returnRemarks(rec)
                };
            })
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 25. Admin verifies a return
app.put('/api/admin/verify-return/:id', async (req, res) => {
    const { id } = req.params;
    const { return_condition } = req.body || {};

    if (!return_condition || !['Good Condition', 'Damaged'].includes(return_condition)) {
        return res.status(400).json({ error: 'Please select the item condition before confirming the return.' });
    }

    try {
        const { data: record, error: findError } = await supabase.from('borrow_records').select('id, status').eq('id', id).maybeSingle();
        if (findError) throw findError;
        if (!record) return res.status(404).json({ error: 'Borrow record not found.' });
        if (record.status === 'renewed') return res.status(400).json({ error: 'This loan was renewed. Verify the return on its renewal record instead.' });

        const update = { admin_verified: true, return_condition, updated_at: new Date().toISOString() };
        // Handed back at the desk instead of the kiosk: record the return now
        if (record.status === 'borrowed') {
            const now = new Date();
            Object.assign(update, { status: 'returned', return_date: now.toLocaleDateString('sv'), return_time: now.toTimeString().slice(0, 8) });
        }

        const { error } = await supabase
            .from('borrow_records')
            .update(update)
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Return verified successfully!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 24. Delete a borrow record
app.delete('/api/admin/delete-borrow/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // First check if the record exists
        const { data: existingRecord, error: findError } = await supabase
            .from('borrow_records')
            .select('id')
            .eq('id', id)
            .single();

        if (findError || !existingRecord) {
            return res.status(404).json({ error: 'Borrow record not found' });
        }

        // Now delete it
        const { error } = await supabase
            .from('borrow_records')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Borrow record deleted successfully!' });
    } catch (error) {
        console.error('Delete borrow error:', error);
        res.status(500).json({ error: error.message || 'Failed to delete borrow record' });
    }
});


// ========== ADVANCED ANALYTICS ENDPOINTS ==========

// Book Usage Analytics
app.get('/api/admin/book-usage', async (req, res) => {
    try {
        const { data: books, error } = await supabase
            .from('borrow_records')
            .select('id, item_title, item_category, borrow_date')
            .order('borrow_date', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        // Group by book title and count
        const bookMap = {};
        (books || []).forEach(b => {
            if (!bookMap[b.item_title]) {
                bookMap[b.item_title] = {
                    title: b.item_title,
                    category: b.item_category,
                    borrow_count: 0,
                    last_borrowed: null
                };
            }
            bookMap[b.item_title].borrow_count++;
            bookMap[b.item_title].last_borrowed = b.borrow_date;
        });

        // Convert to array and sort by borrow count
        const sortedBooks = Object.values(bookMap)
            .sort((a, b) => b.borrow_count - a.borrow_count)
            .slice(0, 20);

        res.json({ books: sortedBooks });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Most Read Book
app.get('/api/admin/most-read-book', async (req, res) => {
    try {
        // Get borrows from borrow_records
        const { data: books, error } = await supabase
            .from('borrow_records')
            .select('item_title, item_category, borrow_date');

        // Get readings from reading_sessions
        const { data: readings, error: readError } = await supabase
            .from('reading_sessions')
            .select('book_accession, action_date');

        if (error) return res.status(500).json({ error: error.message });

        // Count borrows per book
        const bookMap = {};
        
        // Add borrow records
        if (books && books.length > 0) {
            books.forEach(b => {
                if (!bookMap[b.item_title]) {
                    bookMap[b.item_title] = { title: b.item_title, category: b.item_category, count: 0 };
                }
                bookMap[b.item_title].count++;
            });
        }

        // Add reading sessions (study sessions)
        if (readings && readings.length > 0) {
            readings.forEach(r => {
                if (!bookMap[r.book_accession]) {
                    bookMap[r.book_accession] = { title: r.book_accession, category: 'Study Session', count: 0 };
                }
                bookMap[r.book_accession].count++;
            });
        }

        if (Object.keys(bookMap).length === 0) {
            return res.json({ book: null, total_reads: 0 });
        }

        // Find most read
        const mostRead = Object.values(bookMap).reduce((a, b) => 
            b.count > a.count ? b : a
        );

        res.json({
            book: {
                title: mostRead.title,
                category: mostRead.category,
                read_count: mostRead.count
            },
            total_reads: Object.values(bookMap).reduce((sum, b) => sum + b.count, 0)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Visitors by Grade Level (?month=YYYY-MM for one month)
app.get('/api/admin/visitors-by-grade', async (req, res) => {
    try {
        const month = reportMonth(req);
        if (month === null) return res.status(400).json({ error: BAD_MONTH_MESSAGE });
        const { data: logs, error } = await fetchAll(() => inMonth(supabase
            .from('library_logs')
            .select(`id, user_id, user_type`)
            .eq('user_type', 'student'), month));

        if (error) return res.status(500).json({ error: error.message });

        // Get all student IDs and fetch their grades
        const studentIds = [...new Set((logs || []).map(l => l.user_id))];

        if (studentIds.length === 0) {
            return res.json({ month: month || null, grades: [] });
        }

        const { data: students, error: err2 } = await supabase
            .from('users')
            .select('id, grade')
            .in('id', studentIds);

        if (err2) return res.status(500).json({ error: err2.message });

        // Map students
        const studentGradeMap = {};
        (students || []).forEach(s => {
            studentGradeMap[s.id] = s.grade;
        });

        // Count visits per grade
        const gradeMap = {};
        (logs || []).forEach(log => {
            const grade = studentGradeMap[log.user_id] || 'Unknown';
            if (!gradeMap[grade]) {
                gradeMap[grade] = { grade, visits: 0, unique_students: new Set() };
            }
            gradeMap[grade].visits++;
            gradeMap[grade].unique_students.add(log.user_id);
        });

        // Convert and calculate percentages
        const totalVisits = logs.length;
        const grades = Object.values(gradeMap).map(g => ({
            grade: g.grade,
            visits: g.visits,
            unique_students: g.unique_students.size,
            percentage: totalVisits > 0 ? Math.round((g.visits / totalVisits) * 100) : 0
        })).sort((a, b) => b.visits - a.visits);

        res.json({ month: month || null, grades });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Visitors by Purpose (?month=YYYY-MM for one month)
app.get('/api/admin/visitors-by-purpose', async (req, res) => {
    try {
        const month = reportMonth(req);
        if (month === null) return res.status(400).json({ error: BAD_MONTH_MESSAGE });
        const { data: logs, error } = await fetchAll(() => inMonth(supabase
            .from('library_logs')
            .select('visit_reason'), month));

        if (error) return res.status(500).json({ error: error.message });

        // Count visits per purpose
        const purposeMap = {};
        (logs || []).forEach(log => {
            const purpose = log.visit_reason || 'Not Specified';
            purposeMap[purpose] = (purposeMap[purpose] || 0) + 1;
        });

        // Convert and calculate percentages
        const totalVisits = logs.length;
        const purposes = Object.entries(purposeMap)
            .map(([purpose, count]) => ({
                purpose,
                visits: count,
                percentage: totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0
            }))
            .sort((a, b) => b.visits - a.visits);

        res.json({ month: month || null, purposes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Visitors by Gender (?month=YYYY-MM for one month)
app.get('/api/admin/visitors-by-gender', async (req, res) => {
    try {
        const month = reportMonth(req);
        if (month === null) return res.status(400).json({ error: BAD_MONTH_MESSAGE });
        const { data: logs, error } = await fetchAll(() => inMonth(supabase
            .from('library_logs')
            .select(`id, user_id, user_type`), month));

        if (error) return res.status(500).json({ error: error.message });

        // Get all user IDs and fetch their sex
        const studentIds = [...new Set((logs || []).filter(l => l.user_type === 'student').map(l => l.user_id))];
        const facultyIds = [...new Set((logs || []).filter(l => l.user_type === 'faculty').map(l => l.user_id))];

        let sexMap = {};

        // Fetch student sexes
        if (studentIds.length > 0) {
            const { data: students, error: err1 } = await supabase
                .from('users')
                .select('id, sex')
                .in('id', studentIds);

            if (err1) return res.status(500).json({ error: err1.message });
            
            (students || []).forEach(s => {
                sexMap[`student:${s.id}`] = s.sex;
            });
        }

        // Fetch faculty sexes
        if (facultyIds.length > 0) {
            const { data: faculty, error: err2 } = await supabase
                .from('faculty')
                .select('id, sex')
                .in('id', facultyIds);

            if (err2) return res.status(500).json({ error: err2.message });
            
            (faculty || []).forEach(f => {
                sexMap[`faculty:${f.id}`] = f.sex;
            });
        }

        // Count visits per gender
        const genderMap = {};
        (logs || []).forEach(log => {
            const sex = sexMap[`${log.user_type}:${log.user_id}`] || 'Unknown';
            genderMap[sex] = (genderMap[sex] || 0) + 1;
        });

        // Convert and calculate percentages
        const totalVisits = logs.length;
        const genders = Object.entries(genderMap)
            .map(([sex, count]) => ({
                sex,
                visits: count,
                percentage: totalVisits > 0 ? Math.round((count / totalVisits) * 100) : 0
            }))
            .sort((a, b) => b.visits - a.visits);

        res.json({ month: month || null, genders });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BOOK VALIDATION & ANALYTICS ==========

// Validate book accession number or non-print resource code
app.post('/api/validate-book', async (req, res) => {
    const { accession_number } = req.body;

    if (!accession_number) {
        return res.status(400).json({ error: 'Accession number/resource code is required.' });
    }

    try {
        const code = accession_number.trim();
        const { data: book, error: bookError } = await supabase
            .from('books')
            .select('id, accession_number, title, author, category')
            .eq('accession_number', code)
            .single();

        if (book) {
            console.log('[VALIDATE-BOOK] Print book found:', book.title);
            return res.json({ 
                valid: true, 
                type: 'print',
                book: {
                    id: book.id,
                    accession_number: book.accession_number,
                    title: book.title,
                    author: book.author,
                    category: book.category
                }
            });
        }

        const { data: resource, error: resourceError } = await supabase
            .from('non_print_resources')
            .select('id, resource_code, title, name, category')
            .eq('resource_code', code)
            .single();

        if (resource) {
            console.log('[VALIDATE-BOOK] Non-print resource found:', resource.title || resource.name);
            return res.json({ 
                valid: true, 
                type: 'non-print',
                resource: {
                    id: resource.id,
                    resource_code: resource.resource_code,
                    title: resource.title || resource.name,
                    category: resource.category
                }
            });
        }

        console.log('[VALIDATE-BOOK] Resource not found:', accession_number);
        res.status(404).json({ valid: false, error: 'Accession number or resource code not found in database' });
    } catch (error) {
        console.error('[VALIDATE-BOOK] Error:', error);
        res.status(500).json({ valid: false, error: error.message });
    }
});

// Get book reading analytics (most read books). ?month=YYYY-MM limits it to one month.
app.get('/api/book-analytics', async (req, res) => {
    try {
        const month = reportMonth(req);
        if (month === null) return res.status(400).json({ error: BAD_MONTH_MESSAGE });
        // Get all reading sessions with book accession numbers
        const { data: sessions, error: sessionsError } = await fetchAll(() =>
            inMonth(supabase.from('reading_sessions').select('book_accession'), month));

        if (sessionsError) throw sessionsError;

        // Count occurrences of each book accession
        const bookCounts = {};
        (sessions || []).forEach(session => {
            const accession = session.book_accession;
            bookCounts[accession] = (bookCounts[accession] || 0) + 1;
        });

        // Fetch book details for top books
        const accessions = Object.keys(bookCounts);
        if (accessions.length === 0) {
            return res.json({ month: month || null, total_reading_sessions: 0, total_unique_books: 0, analytics: [] });
        }

        const { data: books, error: booksError } = await supabase
            .from('books')
            .select('id, accession_number, title, author, category')
            .in('accession_number', accessions);

        if (booksError) throw booksError;

        // Combine counts with book details and sort by count
        const analytics = (books || [])
            .map(book => ({
                ...book,
                category: SHELF_CODE_BY_CATEGORY[book.category] || book.category || '', // shown as GEN / LAR / FIC / FIL
                read_count: bookCounts[book.accession_number] || 0
            }))
            .sort((a, b) => b.read_count - a.read_count)
            .slice(0, 20); // Top 20 most read books

        res.json({
            month: month || null,
            total_reading_sessions: sessions.length,
            total_unique_books: accessions.length,
            analytics 
        });
    } catch (error) {
        console.error('[BOOK-ANALYTICS] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, (error) => {
        if (error) throw error; // Express 5 passes listen errors (e.g. port in use) here
        console.log(`Server is running on port ${PORT}`);
    });
}

// 11b. Bulk import books (expects { records: [ { accession_number, call_number, title, author, category, copyright_year, isbn }, ... ] })
app.post('/api/admin/import-books', async (req, res) => {
    const payload = req.body && Array.isArray(req.body.records) ? req.body.records : null;
    if (!Array.isArray(payload) || payload.length === 0) return res.status(400).json({ error: 'No records provided' });

    const toInsert = prepareBookImportRows(payload);
    const skipped = payload.length - toInsert.length;
    const skippedNote = skipped ? `. Skipped ${skipped} row(s) with a missing Accession No., Call No./DDC No., Title or Author, an invalid category, or a repeated accession number` : '';

    if (!toInsert.length) {
        return res.status(400).json({ error: `No valid rows to import. Each row needs Accession No., Call No. or DDC No., Title, Author, and a category (${BOOK_CATEGORIES.join(', ')}).` });
    }

    try {
        const { data, error } = await supabase.from('books').upsert(toInsert, { onConflict: 'accession_number' }).select('*');
        if (error) {
            console.error('[IMPORT-BOOKS] error', error);
            if (isMissingColumnError(error)) {
                const fallbackRows = toInsert.map(row => ({
                    accession_number: row.accession_number,
                    call_number: row.call_number,
                    title: row.title,
                    author: row.author,
                    category: row.category,
                    copyright_year: row.copyright_year,
                    isbn: row.isbn
                }));
                const { data: fallbackData, error: fallbackError } = await supabase.from('books').upsert(fallbackRows, { onConflict: 'accession_number' }).select('*');
                if (fallbackError) {
                    return res.status(500).json({ error: fallbackError.message });
                }
                const fallbackCount = Array.isArray(fallbackData) ? fallbackData.length : 0;
                return res.json({ message: `Imported or updated ${fallbackCount} books with core fields only. Run the migration to enable metadata columns${skippedNote}.`, imported: fallbackCount, skipped });
            }
            return res.status(500).json({ error: error.message });
        }
        const importedCount = Array.isArray(data) ? data.length : 0;
        res.json({ message: `Imported or updated ${importedCount} books${skippedNote}`, imported: importedCount, skipped });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 16b. Bulk import non-print resources (expects { records: [ { resource_code, unit, title/name, category, condition, description }, ... ] })
app.post('/api/admin/import-non-print-resources', async (req, res) => {
    const payload = req.body && Array.isArray(req.body.records) ? req.body.records : null;
    if (!Array.isArray(payload) || payload.length === 0) return res.status(400).json({ error: 'No records provided' });

    const toInsert = payload.map(r => ({
        resource_code: (r.resource_code || r.code || r.resourceCode || '').toString().trim(),
        title: (r.title || r.name || '').toString().trim(),
        unit: (r.unit || r.units || r.quantity || '').toString().trim(),
        category: (r.category || r.resource_type || '').toString().trim(),
        condition: (r.condition || r.status || '').toString().trim(),
        description: (r.description || '').toString().trim()
    })).filter(r => r.resource_code && r.unit && r.title && r.category && r.condition);

    if (!toInsert.length) return res.status(400).json({ error: 'No valid rows to import (missing required fields).' });

    try {
        const { error } = await supabase.from('non_print_resources').insert(toInsert);
        if (error) {
            console.error('[IMPORT-NONPRINT] error', error);
            return res.status(500).json({ error: error.message });
        }
        res.json({ message: `Imported ${toInsert.length} resources`, imported: toInsert.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;
module.exports.buildBookRecord = buildBookRecord; // for tests
module.exports.renewalDueDate = renewalDueDate; // for tests
module.exports.reportMonth = reportMonth; // for tests
module.exports.inMonth = inMonth; // for tests
module.exports.issueAdminToken = issueAdminToken; // for tests
module.exports.buildOpacCatalog = buildOpacCatalog; // for tests