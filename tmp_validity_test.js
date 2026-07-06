const http = require("http");
function fetch(url){return new Promise((res,reject)=>{http.get(url,r=>{let data='';r.on('data',c=>data+=c);r.on('end',()=>{try{res(JSON.parse(data));}catch(e){reject(e);}});}).on('error',reject);});}
(async()=>{
  try{
    const [logsRes, studentsRes, facultyRes] = await Promise.all([
      fetch('http://127.0.0.1:3000/api/admin/logs'),
      fetch('http://127.0.0.1:3000/api/admin/students'),
      fetch('http://127.0.0.1:3000/api/admin/faculty')
    ]);
    const logs=logsRes.logs || [];
    const students=studentsRes.students || [];
    const faculty=facultyRes.faculty || [];
    const studentMap=new Map(students.map(s=>[s.id,s]));
    const facultyMap=new Map(faculty.map(f=>[f.id,f]));
    const counts=new Map();
    logs.forEach(log=>{
      const key=`${log.user_type||'unknown'}::${log.user_id||''}`;
      const existing=counts.get(key)||{userType:log.user_type||'unknown',userId:log.user_id,count:0,lastVisit:null,rawLog:log};
      existing.count+=1;
      existing.rawLog=log;
      const logDate=new Date(log.action_date||null);
      if(!isNaN(logDate.getTime())){
        if(!existing.lastVisit||logDate>new Date(existing.lastVisit)) existing.lastVisit=log.action_date;
      }
      counts.set(key,existing);
    });
    const users=Array.from(counts.values()).map(item=>{
      const details={library_id:'',name:'',age:'',grade:'',section:'',session:'',position:'',employee_no:'',subject_area:'',grade_level:''};
      let label='';
      let typeLabel=item.userType;
      if(item.userType==='student'){const s=studentMap.get(item.userId); label=s?.name||item.rawLog.student_name||'Learner'; typeLabel='Learner'; details.library_id=s?.student_id||''; details.name=s?.name||item.rawLog.student_name||''; details.age=s?.age||''; details.grade=s?.grade||''; details.section=s?.section||''; details.session=s?.session||'';} else if(item.userType==='faculty'){const f=facultyMap.get(item.userId); label=f?.name||item.rawLog.student_name||'Faculty'; typeLabel='Faculty'; details.library_id=f?.faculty_id||''; details.name=f?.name||item.rawLog.student_name||''; details.age=f?.age||''; details.position=f?.position||''; details.employee_no=f?.employee_no||''; details.subject_area=f?.subject_area||''; details.grade_level=f?.grade_level||'';} else {label=item.rawLog.student_name||item.rawLog.faculty_name||item.userType||'Unknown'; typeLabel=item.userType; details.name=label;}
      return {...item,label,typeLabel,details};
    }).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
    console.log('Top Users:');
    users.forEach((u,i)=>console.log(`${i+1}. ${u.label} [${u.typeLabel}] visits=${u.count} lastVisit=${u.lastVisit} library_id=${u.details.library_id} grade=${u.details.grade} section=${u.details.section} age=${u.details.age}`));
    console.log('---');
    console.log('Raw logs count', logs.length, 'students', students.length, 'faculty', faculty.length);
  }catch(e){console.error(e);} })();
