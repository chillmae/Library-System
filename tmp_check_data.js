const http = require('http');
function fetchUrl(url){
  return new Promise((resolve,reject)=>{
    http.get(url,res=>{
      let data='';
      res.on('data',chunk=>data+=chunk);
      res.on('end',()=>{
        try{resolve(JSON.parse(data));}catch(e){reject(e);}        
      });
    }).on('error',reject);
  });
}
(async()=>{
  try{
    const urls=['http://127.0.0.1:3000/api/admin/logs','http://127.0.0.1:3000/api/admin/students','http://127.0.0.1:3000/api/admin/faculty'];
    for(const u of urls){
      const data=await fetchUrl(u);
      console.log('URL:', u);
      console.log('type:', typeof data, 'keys', Object.keys(data));
      if(Array.isArray(data.logs)) console.log('logs length', data.logs.length, 'sample', data.logs.slice(0,3));
      if(Array.isArray(data.students)) console.log('students length', data.students.length, 'sample', data.students.slice(0,3));
      if(Array.isArray(data.faculty)) console.log('faculty length', data.faculty.length, 'sample', data.faculty.slice(0,3));
      console.log('---');
    }
  } catch(e){ console.error(e); process.exit(1);} 
})();
