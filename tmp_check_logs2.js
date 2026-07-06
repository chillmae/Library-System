const http = require("http");
function fetch(url){return new Promise((res,rej)=>{http.get(url,r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>{try{res({status:r.statusCode,body:JSON.parse(body)});}catch(e){rej(e);}});}).on('error',rej);});}
(async()=>{
  try{
    const r = await fetch('http://127.0.0.1:3000/api/admin/logs');
    console.log(JSON.stringify(r,null,2));
  }catch(e){console.error(e);process.exit(1);} })();
