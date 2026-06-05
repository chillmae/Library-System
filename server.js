require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves your frontend files

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
            return res.json({ status: 'success', role: 'admin', user_id: user.id, name: user.name });
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

    // IF STUDENT: Check users table
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('student_id', trimmedId)
        .single();

    if (!user) return res.status(401).json({ error: 'Student ID not found. Please check your ID.' });

    // IF ADMIN: Enforce password check
    if (user.role === 'admin') {
        if (!password || user.password !== password) {
            return res.status(401).json({ error: 'Invalid admin password. Access denied.' });
        }
        return res.json({ status: 'success', role: 'admin', user_id: user.id, name: user.name });
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
        
        console.log('[CHECKIN] Formatted checkInTime:', checkInTime);
        
        const { data, error } = await supabase
            .from('library_logs')
            .insert([{ 
                user_id, 
                visit_reason,
                user_type: user_type || 'student',
                action_date: today,
                check_in_time: checkInTime
            }]);

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

        // Step 2: Separate students and faculty IDs
        const studentIds = [...new Set(activeUsers.filter(log => log.user_type === 'student').map(log => log.user_id))];
        const facultyIds = [...new Set(activeUsers.filter(log => log.user_type === 'faculty').map(log => log.user_id))];
        
        console.log(`[DEBUG] Student IDs: ${studentIds.join(', ')}`);
        console.log(`[DEBUG] Faculty IDs: ${facultyIds.join(', ')}`);

        // Step 3: Fetch student data
        const studentMap = {};
        if (studentIds.length > 0) {
            const { data: students, error: studentsError } = await supabase
                .from('users')
                .select('id, name, student_id, grade, section, sex, birthdate, age')
                .in('id', studentIds);

            if (studentsError) {
                console.error('[ERROR] Failed to fetch students:', studentsError);
                return res.status(500).json({ error: studentsError.message });
            }

            (students || []).forEach(student => {
                studentMap[student.id] = { ...student, user_type: 'student' };
            });
        }

        // Step 4: Fetch faculty data
        const facultyMap = {};
        if (facultyIds.length > 0) {
            const { data: faculty, error: facultyError } = await supabase
                .from('faculty')
                .select('id, name, faculty_id, position, sex, birthdate, age')
                .in('id', facultyIds);

            if (facultyError) {
                console.error('[ERROR] Failed to fetch faculty:', facultyError);
                return res.status(500).json({ error: facultyError.message });
            }

            (faculty || []).forEach(fac => {
                facultyMap[fac.id] = { ...fac, user_type: 'faculty' };
            });
        }

        // Step 5: Fetch books from reading_sessions for each user
        const allUserIds = [...studentIds, ...facultyIds];
        const userBooksMap = {};
        if (allUserIds.length > 0) {
            const { data: readings, error: readingsError } = await supabase
                .from('reading_sessions')
                .select('user_id, book_accession')
                .in('user_id', allUserIds)
                .eq('action_date', today);

            if (!readingsError && readings && readings.length > 0) {
                readings.forEach(reading => {
                    if (!userBooksMap[reading.user_id]) {
                        userBooksMap[reading.user_id] = [];
                    }
                    userBooksMap[reading.user_id].push(reading.book_accession);
                });
            }
        }

        // Step 6: Combine the data
        const userMap = { ...studentMap, ...facultyMap };

        const formattedUsers = activeUsers.map(log => {
            const userData = userMap[log.user_id] || {};
            return {
                log_id: log.id,
                user_id: log.user_id,
                name: userData.name || 'Unknown',
                student_id: userData.student_id || 'N/A',
                faculty_id: userData.faculty_id || 'N/A',
                grade: userData.grade || 'N/A',
                section: userData.section || 'N/A',
                position: userData.position || 'N/A',
                sex: userData.sex || 'N/A',
                birthdate: userData.birthdate || 'N/A',
                age: userData.age || 'N/A',
                user_type: log.user_type || 'student',
                check_in_time: log.check_in_time,
                visit_reason: log.visit_reason,
                books: userBooksMap[log.user_id] || []
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
    const { student_id, name, grade, section, sex, birthdate, age } = req.body;

    if (!student_id || !name) {
        return res.status(400).json({ error: 'Student ID and Name are required.' });
    }

    const { data, error } = await supabase
        .from('users')
        .insert([{ student_id: student_id, name, grade, section, sex, birthdate, age: age || null, password: 'NOT_REQUIRED', role: 'student' }]);

    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'This Student ID is already registered.' });
        }
        return res.status(500).json({ error: error.message });
    }

    res.json({ message: `Student ${student_id} (${name}) successfully registered!` });
});

// 5. Admin: Get all students
app.get('/api/admin/students', async (req, res) => {
    try {
        const { data: students, error } = await supabase
            .from('users')
            .select('*')
            .eq('role', 'student')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ students });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6. Admin: Update a student
app.put('/api/admin/students/:id', async (req, res) => {
    const { id } = req.params;
    const { name, grade, section, sex, birthdate, age } = req.body;

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ name, grade, section, sex, birthdate, age: age || null })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        res.json({ message: 'Student updated successfully' });
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
        const { error: logsError } = await supabase
            .from('library_logs')
            .delete()
            .eq('user_id', studentId); // Assuming user_id links to student ID

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

// ========== FACULTY ENDPOINTS ==========

// Add Faculty
app.post('/api/admin/add-faculty', async (req, res) => {
    const { faculty_id, name, position, sex, birthdate, age } = req.body;

    if (!faculty_id || !name) {
        return res.status(400).json({ error: 'Faculty ID and Name are required.' });
    }

    const { data, error } = await supabase
        .from('faculty')
        .insert([{ faculty_id, name, position, sex, birthdate, age: age || null }]);

    if (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'This Faculty ID is already registered.' });
        }
        return res.status(500).json({ error: error.message });
    }

    res.json({ message: `Faculty ${faculty_id} (${name}) successfully registered!` });
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
    const { name, position, sex, birthdate, age } = req.body;

    try {
        const { data, error } = await supabase
            .from('faculty')
            .update({ name, position, sex, birthdate, age: age || null })
            .eq('id', id);

        if (error) return res.status(500).json({ error: error.message });

        res.json({ message: 'Faculty updated successfully' });
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

// 8. Admin: Get analytics data (Fixed Local Time Implementation)
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const today = new Date().toLocaleDateString('sv'); 
        const thisMonth = today.substring(0, 7);

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
            .lte('action_date', `${thisMonth}-31`);

        // Fetch logs for the last 7 days to build the chart
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const startDateStr = sevenDaysAgo.toLocaleDateString('sv');

        const { data: chartLogs, error: err6 } = await supabase
            .from('library_logs')
            .select('action_date')
            .gte('action_date', startDateStr)
            .lte('action_date', today);

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

// 9. Admin: Get all activity logs with student details
app.get('/api/admin/logs', async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from('library_logs')
            .select(`
                id,
                user_id,
                action_date,
                check_in_time,
                check_out_time,
                visit_reason,
                users(name, student_id)
            `)
            .order('check_in_time', { ascending: false })
            .limit(100);

        if (error) return res.status(500).json({ error: error.message });

        const formattedLogs = logs.map(log => ({
            id: log.id,
            user_id: log.user_id,
            action_date: log.action_date,
            check_in_time: log.check_in_time,
            check_out_time: log.check_out_time,
            visit_reason: log.visit_reason,
            student_name: log.users?.name || log.users?.student_id || 'Unknown'
        }));

        res.json({ logs: formattedLogs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BOOKS MANAGEMENT API ==========

// 10. Get all books
app.get('/api/admin/books', async (req, res) => {
    try {
        const { data: books, error } = await supabase
            .from('books')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        res.json({ books: books || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 11. Add a new book
app.post('/api/admin/add-book', async (req, res) => {
    const { accession_number, call_number, title, author, category, copyright_year, isbn } = req.body;
    console.log('[ADD-BOOK] Received request body:', req.body);
    console.log('[ADD-BOOK] Category value:', category);

    if (!accession_number || !call_number || !title || !author || !category) {
        return res.status(400).json({ error: 'Accession Number, Call Number, Title, Author, and Category are required.' });
    }

    try {
        const { data, error } = await supabase
            .from('books')
            .insert([{ 
                accession_number: accession_number.trim(),
                call_number: call_number.trim(),
                title: title.trim(),
                author: author.trim(),
                category: category.trim(),
                copyright_year: copyright_year ? parseInt(copyright_year) : null,
                isbn: isbn ? isbn.trim() : null
            }]);

        if (error) {
            console.error('[ADD-BOOK] Database error:', error);
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Accession Number already exists. Please use a unique number.' });
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
    const { accession_number, call_number, title, author, category, copyright_year, isbn } = req.body;
    console.log('[UPDATE-BOOK] ID:', id, 'Request body:', req.body);
    console.log('[UPDATE-BOOK] Category value:', category);

    try {
        const { data, error } = await supabase
            .from('books')
            .update({
                accession_number: accession_number?.trim(),
                call_number: call_number?.trim(),
                title: title?.trim(),
                author: author?.trim(),
                category: category?.trim(),
                copyright_year: copyright_year ? parseInt(copyright_year) : null,
                isbn: isbn ? isbn.trim() : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) {
            console.error('[UPDATE-BOOK] Database error:', error);
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Accession Number already exists.' });
            }
            return res.status(500).json({ error: error.message });
        }

        console.log('[UPDATE-BOOK] Book updated successfully');
        res.json({ message: 'Book updated successfully!' });
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

        res.json({ resources: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 16. Add a new non-print resource
app.post('/api/admin/add-non-print-resource', async (req, res) => {
    const { code, unit, name, category, condition } = req.body;

    if (!code || !unit || !name || !category || !condition) {
        return res.status(400).json({ error: 'Code, Unit, Name, Category, and Condition are required.' });
    }

    try {
        const { data, error } = await supabase
            .from('non_print_resources')
            .insert([{ 
                code: code.trim(),
                unit: unit.trim(),
                name: name.trim(),
                category: category.trim(),
                condition: condition.trim()
            }]);

        if (error) {
            if (error.code === '23505') {
                return res.status(400).json({ error: 'Code already exists. Please use a unique code.' });
            }
            throw error;
        }

        res.json({ message: 'Resource added successfully!', resource: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 17. Update a non-print resource
app.put('/api/admin/non-print-resources/:id', async (req, res) => {
    const { id } = req.params;
    const { code, unit, name, category, condition } = req.body;

    try {
        const { data, error } = await supabase
            .from('non_print_resources')
            .update({
                code: code?.trim(),
                unit: unit?.trim(),
                name: name?.trim(),
                category: category?.trim(),
                condition: condition?.trim(),
                updated_at: new Date().toISOString()
            })
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
            return res.status(404).json({ error: 'Book not found in the library. Please check the accession number.' });
        }

        const now = new Date();
        const borrow_date = now.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Format time as HH:MM:SS
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const borrow_time = `${hours}:${minutes}:${seconds}`;

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
                status: 'borrowed'
            }]);

        if (error) {
            console.error('[BORROW] Database error:', error);
            throw error;
        }

        console.log('[BORROW] Record created successfully');
        res.json({ message: 'Borrow recorded successfully!', record: data });
    } catch (error) {
        console.error('[BORROW] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 20. Get all pending borrows for admin verification
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

    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .update({
                admin_verified: true,
                updated_at: new Date().toISOString()
            })
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
        const return_date = now.toISOString().split('T')[0];
        
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

// 24. Admin gets pending returns for verification
app.get('/api/admin/pending-returns', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .select('*')
            .eq('status', 'returned')
            .eq('admin_verified', false)
            .order('return_date', { ascending: true });

        if (error) throw error;

        res.json({ records: data || [] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 25. Admin verifies a return
app.put('/api/admin/verify-return/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { data, error } = await supabase
            .from('borrow_records')
            .update({
                admin_verified: true,
                updated_at: new Date().toISOString()
            })
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

// Visitors by Grade Level
app.get('/api/admin/visitors-by-grade', async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from('library_logs')
            .select(`id, user_id, user_type`)
            .eq('user_type', 'student');

        if (error) return res.status(500).json({ error: error.message });

        // Get all student IDs and fetch their grades
        const studentIds = [...new Set((logs || []).map(l => l.user_id))];
        
        if (studentIds.length === 0) {
            return res.json({ grades: [] });
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

        res.json({ grades });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Visitors by Purpose
app.get('/api/admin/visitors-by-purpose', async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from('library_logs')
            .select('visit_reason');

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

        res.json({ purposes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Visitors by Gender
app.get('/api/admin/visitors-by-gender', async (req, res) => {
    try {
        const { data: logs, error } = await supabase
            .from('library_logs')
            .select(`id, user_id, user_type`);

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
                sexMap[s.id] = s.sex;
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
                sexMap[f.id] = f.sex;
            });
        }

        // Count visits per gender
        const genderMap = {};
        (logs || []).forEach(log => {
            const sex = sexMap[log.user_id] || 'Unknown';
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

        res.json({ genders });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========== BOOK VALIDATION & ANALYTICS ==========

// Validate book accession number
app.post('/api/validate-book', async (req, res) => {
    const { accession_number } = req.body;

    if (!accession_number) {
        return res.status(400).json({ error: 'Accession number is required.' });
    }

    try {
        const { data: book, error } = await supabase
            .from('books')
            .select('id, accession_number, title, author, category')
            .eq('accession_number', accession_number.trim())
            .single();

        if (error || !book) {
            console.log('[VALIDATE-BOOK] Book not found:', accession_number);
            return res.status(404).json({ valid: false, error: 'Book accession number not found in database' });
        }

        console.log('[VALIDATE-BOOK] Book found:', book.title);
        res.json({ 
            valid: true, 
            book: {
                id: book.id,
                accession_number: book.accession_number,
                title: book.title,
                author: book.author,
                category: book.category
            }
        });
    } catch (error) {
        console.error('[VALIDATE-BOOK] Error:', error);
        res.status(500).json({ valid: false, error: error.message });
    }
});

// Get book reading analytics (most read books)
app.get('/api/book-analytics', async (req, res) => {
    try {
        // Get all reading sessions with book accession numbers
        const { data: sessions, error: sessionsError } = await supabase
            .from('reading_sessions')
            .select('book_accession');

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
            return res.json({ analytics: [], top_books: [] });
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
                read_count: bookCounts[book.accession_number] || 0
            }))
            .sort((a, b) => b.read_count - a.read_count)
            .slice(0, 20); // Top 20 most read books

        res.json({ 
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
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});