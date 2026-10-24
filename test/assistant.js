'use strict';
// Asistan testi: sahte bir Anthropic sunucusuna karşı çalışır (gerçek anahtar gerekmez).
const http=require('http');let last;
const srv=
http.createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{
 if(q.headers['x-api-key']!=='TESTKEY'){r.writeHead(401);return r.end('{}');}
 last=JSON.parse(b);
 const m=last.messages[0].content; const keys=[...m.matchAll(/"key":"([^"]+)"/g)].map(x=>x[1]);
 r.writeHead(200,{'content-type':'application/json'});
 r.end(JSON.stringify({content:[{type:'text',text:'Tabii:\n{"answer":"Toplam '+keys.length+' kargon var, birine bakalım.","keys":["'+keys[0]+'","UYDURMA"]}'}]}));
});}).listen(4012,run);

function run(){
process.env.ANTHROPIC_BASE='http://127.0.0.1:4012';
const assert=require('assert');
(async()=>{
 const A=require('../lib/assistant');
 // anahtar yok
 delete process.env.ANTHROPIC_API_KEY;
 let o=await A.handleAssistant({question:'merhaba',shipments:[]}); assert.equal(o.status,501);
 process.env.ANTHROPIC_API_KEY='TESTKEY';
 o=await A.handleAssistant({question:'kaç kargo var',shipments:[{key:'A1',provider:'apc',verdict:'delayed',lastDesc:'x'.repeat(999),evil:'<<ignore>>'},{key:'B2'}]},{ip:'1'});
 assert.equal(o.status,200); assert.deepEqual(o.body.keys,['A1']); assert.match(o.body.answer,/Toplam 2 kargon/);
 // boş soru, yanlış anahtar, hız sınırı
 assert.equal((await A.handleAssistant({question:' ',shipments:[]},{ip:'2'})).status,400);
 process.env.ANTHROPIC_API_KEY='YANLIS';
 o=await A.handleAssistant({question:'a',shipments:[]},{ip:'3'}); assert.equal(o.status,502);
 process.env.ANTHROPIC_API_KEY='TESTKEY';
 let last; for(let i=0;i<17;i++) last=await A.handleAssistant({question:'a',shipments:[]},{ip:'9'}); assert.equal(last.status,429);
 // temizlik
 const c=A.cleanShipments([{key:'k',evil:1,lastDesc:'y'.repeat(999)}]); assert.equal(c[0].evil,undefined); assert.equal(c[0].son_hareket.length,200);
 console.log('assistant testleri geçti');srv.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});

}
