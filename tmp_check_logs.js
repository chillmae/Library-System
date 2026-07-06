const http=require('http');
function fetch(url){return new Promise((res,rej)=>{http.get(url,r=>{let data='';r.on('data',c=>data+=c);r.on('end',()=>{try{res(JSON.parse(data));}catch(e){rej(e);}});}).on('error',rej);});}
(async()=>{
 try{
   const logs = await fetch('http://127.0.0.1:3000/api/admin/logs');
   console.log(JSON.stringify(logs, null, 2).slice(0,2000));
 }catch(e){console.error('ERROR',e);}
})();
