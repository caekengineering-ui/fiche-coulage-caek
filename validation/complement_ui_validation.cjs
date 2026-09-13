const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require(require.resolve('jsdom',{paths:[path.resolve(process.argv[2]||'.audit-runtime')]}));
const dom=new JSDOM('<div id="comp-atester-liste"></div><div id="comp-historique-liste"></div><div id="comp-detail"><div id="comp-detail-body"></div></div>',{runScripts:'outside-only'});
const w=dom.window,root=path.resolve(__dirname,'..');
const c={ref:'AUDIT',dateCoulage:'2026-08-01',malaxeurs:[{preleve:true,prelType:'cube',prelNombre:15}]};
for(const file of ['model.js','integrite.js'])w.eval(fs.readFileSync(path.join(root,'js',file),'utf8'));
const full=w.CAEKModel.allCodes(c),codes=full.slice(3,6);
let lot={id:1,lotKey:'AUDIT-L28',ref:'AUDIT',ageJours:28,age:'28j',dateCoulage:c.dateCoulage,dateSortie:'2026-08-28',
 datePrevue:'2026-08-29',statut:'sorti',codes,nombre:3,essais:[{code:codes[2].code,force:900,dim1:150,dim2:150},
 {code:codes[0].code,force:777,dim1:150,dim2:150}]};
let requests=0,complete=false,alerts=[];
w.CAEKDB={getAllCoulages:async()=>[c],getAllLots:async()=>[lot]};
w.CAEKOperateurs={isAdmin:()=>false,token:()=>'Operator'};
w.CAEKServer={listLots:async()=>[{coulage_ref:'AUDIT',codes:full.slice(0,6)}],
 upsertLot:async(t,k,draft)=>{lot=draft;return{ok:true}},
 completerLot:async(t,k,selected,motif,rev)=>{requests++;assert.equal(selected.length,12);assert.equal(rev,0);
  lot={...lot,codes:full.slice(3),nombre:12,correctionRevision:1,correctionEnAttente:true};return{ok:true,pending:true}}};
w.CAEKLots={pull:async()=>{complete=true;return{ok:true}}};
w.prompt=(message,initial)=>initial; w.confirm=()=>true;w.alert=s=>alerts.push(s);
w.eval(fs.readFileSync(path.join(root,'js/compression.js'),'utf8'));
(async()=>{try{
 w.CAEKCompression.init();await w.CAEKCompression.refresh();w.document.querySelector('.comp-lot-card').click();
 assert.equal(w.document.querySelectorAll('.comp-row').length,3);
 assert.equal(w.document.querySelector('.comp-row .comp-force').value,'777','résultat rattaché au code, pas à son ancien index');
 w.document.querySelector('#comp-complement').click();
 for(let i=0;i<40 && w.document.querySelectorAll('.comp-row').length!==12;i++)await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(alerts,[]);assert.equal(requests,1);assert.equal(complete,true);
 assert.equal(w.document.querySelectorAll('.comp-row').length,12);
 assert.equal(w.document.querySelector('.comp-row .comp-force').value,'777');
 assert.ok(w.document.body.textContent.includes("en attente d'autorisation"));
 console.log('OK interface Test : 3 → 12 cases, 9 ajouts proposés, résultats conservés par code, attente affichée.');
}finally{w.close()}})().catch(e=>{console.error(e);process.exitCode=1});
