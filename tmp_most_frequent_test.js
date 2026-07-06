const http = require("http");
const urls = ['http://127.0.0.1:3000/api/admin/logs','http://127.0.0.1:3000/api/admin/students','http://127.0.0.1:3000/api/admin/faculty'];
const results = {};
function fetchUrl(url){
  return new Promise((res, rej) => {
    http.get(url, r => {
      let data = '';
      r.on('data', chunk => data += chunk);
      r.on('end', () => {
        try { res(JSON.parse(data)); }
        catch (e) { rej(e); }
      });
    }).on('error', rej);
  });
}
(async () => {
  try {
    for (const url of urls) {
      const key = url.split('/').pop();
      results[key] = await fetchUrl(url);
    }
    const logs = (results.logs && results.logs.logs) || results.logs || [];
    const students = (results.students && results.students.students) || results.students || [];
    const faculty = (results.faculty && results.faculty.faculty) || results.faculty || [];
    if (!logs.length) {
      console.log('NO LOGS');
      return;
    }
    const studentMap = new Map(students.map(s => [s.id, s]));
    const facultyMap = new Map(faculty.map(f => [f.id, f]));
    const counts = new Map();
    logs.forEach(log => {
      const key = `${log.user_type || 'unknown'}::${log.user_id || ''}`;
      const existing = counts.get(key) || {
        userType: log.user_type || 'unknown',
        userId: log.user_id,
        label: '',
        count: 0,
        lastVisit: null,
        details: null,
        rawLog: log
      };
      existing.count += 1;
      existing.rawLog = log;
      const date = new Date(log.action_date || log.date_borrowed || log.created_at || null);
      if (!Number.isNaN(date.getTime())) {
        if (!existing.lastVisit || date > new Date(existing.lastVisit)) {
          existing.lastVisit = log.action_date || log.date_borrowed || log.created_at;
        }
      }
      counts.set(key, existing);
    });
    const users = Array.from(counts.values()).map(item => {
      let label = '';
      let typeLabel = '';
      let details = {
        library_id: '', name: '', age: '', grade: '', section: '', session: '', position: '', employee_no: '', subject_area: '', grade_level: ''
      };
      if (item.userType === 'student') {
        const student = studentMap.get(item.userId);
        label = student?.name || item.rawLog?.student_name || 'Learner';
        typeLabel = 'Learner';
        details = {
          library_id: student?.student_id || item.rawLog?.student_id || '',
          name: student?.name || item.rawLog?.student_name || '',
          age: student?.age || item.rawLog?.age || '',
          grade: student?.grade || item.rawLog?.grade || '',
          section: student?.section || item.rawLog?.section || '',
          session: student?.session || item.rawLog?.session || '',
          position: '', employee_no: '', subject_area: '', grade_level: ''
        };
      } else if (item.userType === 'faculty') {
        const facultyRec = facultyMap.get(item.userId);
        label = facultyRec?.name || item.rawLog?.faculty_name || 'Faculty';
        typeLabel = 'Faculty';
        details = {
          library_id: facultyRec?.faculty_id || item.rawLog?.faculty_id || '',
          name: facultyRec?.name || item.rawLog?.faculty_name || '',
          age: facultyRec?.age || item.rawLog?.age || '',
          grade: '', section: '', session: '',
          position: facultyRec?.position || item.rawLog?.position || '',
          employee_no: facultyRec?.employee_no || item.rawLog?.employee_no || '',
          subject_area: facultyRec?.subject_area || item.rawLog?.subject_area || '',
          grade_level: facultyRec?.grade_level || item.rawLog?.grade_level || ''
        };
      } else {
        label = item.rawLog?.student_name || item.rawLog?.faculty_name || item.userType || 'Unknown';
        typeLabel = item.userType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        details = {
          library_id: item.rawLog?.student_id || item.rawLog?.faculty_id || '',
          name: label,
          age: item.rawLog?.age || '',
          grade: item.rawLog?.grade || '',
          section: item.rawLog?.section || '',
          session: item.rawLog?.session || '',
          position: item.rawLog?.position || '',
          employee_no: item.rawLog?.employee_no || '',
          subject_area: item.rawLog?.subject_area || '',
          grade_level: item.rawLog?.grade_level || ''
        };
      }
      return { ...item, label, typeLabel, details };
    }).filter(item => item.label && item.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    console.log('Top 3 frequent users:');
    users.slice(0, 3).forEach((u, i) => {
      console.log(`${i + 1}. ${u.label} (${u.typeLabel}) - ${u.count} visits - lastVisit=${u.lastVisit} - id=${u.details.library_id} - grade=${u.details.grade} - section=${u.details.section} - age=${u.details.age}`);
    });
    console.log('Total unique users counted:', users.length);
  } catch (e) {
    console.error('ERROR', e);
    process.exit(1);
  }
})();
