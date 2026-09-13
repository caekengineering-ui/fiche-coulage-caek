/* Usage: node validation/integrite_validation.cjs <directory containing node_modules> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const {PGlite} = require(require.resolve('@electric-sql/pglite', {paths: [path.resolve(process.argv[2] || '.audit-runtime')]}));
const cx = {window:{}, document:{}, console}; vm.createContext(cx);
for (const file of ['model.js','integrite.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),cx);
cx.window.CAEKModel = cx.CAEKModel;
const coulage={ref:'AUDIT',dateCoulage:'2026-09-01',malaxeurs:[{preleve:true,prelType:'cube',prelNombre:15}]};
const proposed=cx.CAEKModel.proposeRepartition(coulage);
assert.deepEqual(Array.from(proposed,l=>l.nombre),[3,12]);
assert.equal(cx.CAEKIntegrite.verifier(coulage,proposed).ok,true);
const partial=JSON.parse(JSON.stringify(proposed));partial[1].codes=partial[1].codes.slice(0,3);partial[1].nombre=3;
assert.equal(cx.CAEKIntegrite.verifier(coulage,partial).ok,false);
const duplicate=JSON.parse(JSON.stringify(proposed));duplicate[1].codes[0]=duplicate[0].codes[0];
assert.equal(cx.CAEKIntegrite.verifier(coulage,duplicate).ok,false);
let count=3; const db=new PGlite();
async function check(name, value){assert.ok(value,name);count++;console.log('OK',name);}
async function rpc(name,args){const p=args.map((_,i)=>'$'+(i+1)).join(','); return (await db.query(`select public.${name}(${p}) as r`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].r;}
(async()=>{try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.operators(id uuid,nom text,is_admin boolean,labo_id uuid,admin_labos uuid[]);
 create table public.coulages(ref text primary key,labo_id uuid,payload jsonb,version int default 1,updated_at timestamptz default now());
 create table public.lots(id uuid default gen_random_uuid(),lot_key text unique,coulage_ref text,labo_id uuid,prel int,type text,age_jours int,nombre int,codes jsonb,date_coulage date,date_echeance date,statut text,resultats jsonb,ecrase_par text,payload jsonb,resultats_valides_par text,resultats_valides_at timestamptz,updated_at timestamptz default now());
 insert into operators values('00000000-0000-0000-0000-000000000001','Operator',false,'00000000-0000-0000-0000-000000000010',null),('00000000-0000-0000-0000-000000000002','Admin',true,'00000000-0000-0000-0000-000000000010',null);
 create function public._op_by_token(t text) returns public.operators language sql as 'select * from operators where nom=t';
 create function public._admin_can(t text,l uuid) returns boolean language sql as 'select coalesce((select is_admin and labo_id=l from operators where nom=t),false)';
 create function public._lot_scope_ok(r public.operators,l public.lots) returns boolean language sql as 'select r.labo_id=l.labo_id';`);
 const original=fs.readFileSync(path.join(root,'supabase_lots_sync.sql'),'utf8');
 await db.exec(original.slice(original.indexOf('create or replace function public.op_upsert_lot'),original.indexOf('-- Suppression')));
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260913090000_integrite_repartition.sql'),'utf8');
 await db.exec(migration); await db.exec(migration); // re-exécution sûre
 await db.query('insert into coulages(ref,labo_id,payload) values($1,$2,$3)',['AUDIT','00000000-0000-0000-0000-000000000010',JSON.stringify(coulage)]);
 await check('6/15 refusé atomiquement',(await rpc('op_replace_repartition',['Operator','AUDIT',partial,[]])).error==='repartition_incomplete');
 await check('aucun lot créé sur refus',(await db.query('select * from lots')).rows.length===0);
 await check('doublon refusé',(await rpc('op_replace_repartition',['Operator','AUDIT',duplicate,[]])).error==='repartition_incomplete');
 await check('répartition 3+12 acceptée',(await rpc('op_replace_repartition',['Operator','AUDIT',proposed,[]])).ok);
 await check('ancien snapshot refusé',(await rpc('op_replace_repartition',['Operator','AUDIT',proposed,[]])).error==='conflit_repartition');
 const rows=(await db.query('select * from lots order by age_jours')).rows, seven=rows[0], target=rows[1];
 const before7=JSON.stringify(seven);
 // Simule une ancienne répartition incomplète déjà sortie, sans résultat.
 const short=target.codes.slice(0,3);
 await db.query("update lots set codes=$1,nombre=3,statut='sorti',payload=payload||jsonb_build_object('codes',$1::jsonb,'nombre',3,'statut','sorti') where lot_key=$2",[JSON.stringify(short),target.lot_key]);
 const all=target.codes.map(c=>c.code);
 await check('complément opérateur accepté, en attente',(await rpc('op_completer_lot',['Operator',target.lot_key,all,'Erreur bassin',0,null])).pending===true);
 await check('7 jours intact',JSON.stringify((await db.query('select * from lots where lot_key=$1',[seven.lot_key])).rows[0])===before7);
 await check('rejeu revision périmée refusé',(await rpc('op_completer_lot',['Admin',target.lot_key,all,'Erreur bassin',0,null])).error==='conflit_revision');
 await check('opérateur ne peut approuver',(await rpc('op_approuver_complement',['Operator',target.lot_key,1])).error==='admin');
 const essays=all.map(code=>({code,dim1:150,dim2:150,dateEssai:'2026-09-29',force:900,rc:40}));
 let current=(await db.query('select * from lots where lot_key=$1',[target.lot_key])).rows[0];
 let payload={...current.payload,essais:essays,statut:'teste'};
 await check('12 résultats saisis avant autorisation',(await rpc('op_upsert_lot',['Operator',target.lot_key,payload])).ok);
 let blocked=false;try {await db.query("update lots set statut='valide' where lot_key=$1",[target.lot_key]);}catch(e){blocked=e.message.includes('correction_en_attente');}
 await check('validation bloquée avant autorisation',blocked);
 await check('responsable autorise',(await rpc('op_approuver_complement',['Admin',target.lot_key,1])).ok);
 await check('ancienne copie ne peut annuler autorisation',(await rpc('op_upsert_lot',['Operator',target.lot_key,payload])).error==='conflit_revision');
 blocked=false;try{await db.query("update lots set statut='valide',payload=jsonb_set(payload,'{essais}',$1) where lot_key=$2",[JSON.stringify(essays.slice(0,3)),target.lot_key]);}catch(e){blocked=e.message.includes('essais_incoherents');}
 await check('PV/validation 3 résultats pour 12 refusé',blocked);
 await db.query("update lots set statut='valide' where lot_key=$1",[target.lot_key]);
 await check('12 résultats autorisés validables',(await db.query('select statut from lots where lot_key=$1',[target.lot_key])).rows[0].statut==='valide');
 await check('audit des opérations présent',(await db.query('select count(*)::int n from lot_corrections_historique')).rows[0].n===3);
 await check('code déjà testé à 7 jours refusé',(await rpc('op_completer_lot',['Admin',target.lot_key,all.concat(seven.codes.map(c=>c.code)),'Erreur bassin',2,null])).error==='code_occupe');
 const beforeC=(await db.query('select payload from coulages')).rows[0].payload;
 await check('code inconnu refusé',(await rpc('op_completer_lot',['Admin',target.lot_key,all.concat('AUDIT-E1-99'),'Erreur bassin',2,{malaxeur:1,nombre:18}])).error==='code_inconnu');
 await check('prélèvement inchangé après refus',JSON.stringify((await db.query('select payload from coulages')).rows[0].payload)===JSON.stringify(beforeC));
 const extended=all.concat(['AUDIT-E1-16','AUDIT-E1-17','AUDIT-E1-18']);
 await check('responsable rectifie prélèvement sous-déclaré',(await rpc('op_completer_lot',['Admin',target.lot_key,extended,'Rectification prélèvement',2,{malaxeur:1,nombre:18}])).ok);
 const reopened=(await db.query('select * from lots where lot_key=$1',[target.lot_key])).rows[0];
 await check('résultats historiques conservés',reopened.payload.essais.length===12 && reopened.statut==='sorti' && !reopened.payload.resultatsValides);
 await check('ancien PV nécessite une nouvelle validation',reopened.resultats_valides_at===null);
 await check('opérateur sans accès à validation bureau',(await rpc('bureau_valider_complement',[target.lot_key,3,essays,'Admin','Operator'])).error==='admin');
 await db.exec(`set request.jwt.claims='{"role":"service_role"}'`);
 await check('bureau refuse résultats incomplets',(await rpc('bureau_valider_complement',[target.lot_key,3,essays,'Admin','Operator'])).error==='essais_incoherents');
 await check('bureau publie le complément complet',(await rpc('bureau_valider_complement',[target.lot_key,3,extended.map(code=>({...essays[0],code})),'Admin','Operator'])).ok);
 await check('RPC historique interne inaccessible',!(await db.query("select has_function_privilege('anon','public._op_upsert_lot_avant_integrite(text,text,jsonb)','execute') as allowed")).rows[0].allowed);
 console.log(count+' contrôles réussis');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
