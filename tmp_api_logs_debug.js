const http = require("http");
function fetch(url){return new Promise((resolve,reject)=>{http.get(url,res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>{try{resolve({status: res.statusCode, body: JSON.parse(body)});}catch(e){reject(e);}});}).on('error',reject);});}
(async()=>{
 try{const r=await fetch('http://127.0.0.1:3000/api/admin/logs'); console.log(JSON.stringify(r,null,2));}catch(e){console.error(e);} })();
