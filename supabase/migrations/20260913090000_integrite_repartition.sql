-- Répartition atomique et complément d'éprouvettes après sortie du bassin.
-- Transaction unique ; aucune fiche existante n'est réécrite à l'installation.
begin;

create table if not exists public.lot_corrections_historique (
  id uuid primary key default gen_random_uuid(),
  lot_key text not null, coulage_ref text not null, auteur text not null,
  motif text not null, avant jsonb not null, apres jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.lot_corrections_historique enable row level security;
revoke all on public.lot_corrections_historique from anon, authenticated;

-- Miroir des trois générations de CAEKModel.prelevements/allCodes.
create or replace function public._repartition_codes(p_ref text, p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare m jsonb; pr jsonb; out_codes jsonb := '[]'; prels jsonb := '[]';
  modern boolean; ei int := 0; mi int := 0; n int; j int; typ text;
begin
  select exists(select 1 from jsonb_array_elements(coalesce(p->'malaxeurs','[]')) x
    where x->>'preleve' = 'true' and (coalesce(x->>'prelType','') <> '' or coalesce(nullif(x->>'prelNombre',''),'0')::int > 0)) into modern;
  if modern then
    for m in select value from jsonb_array_elements(coalesce(p->'malaxeurs','[]')) loop
      mi := mi + 1;
      if m->>'preleve' = 'true' and (coalesce(m->>'prelType','') <> '' or coalesce(nullif(m->>'prelNombre',''),'0')::int > 0) then
        prels := prels || jsonb_build_array(jsonb_build_object('nombre',coalesce(nullif(m->>'prelNombre',''),'0')::int,'type',coalesce(m->>'prelType','cube'),'malaxeur',mi));
      end if;
    end loop;
  elsif jsonb_typeof(p->'prelevements') = 'array' then
    prels := p->'prelevements';
  else
    for m in select value from jsonb_array_elements(coalesce(p->'malaxeurs','[]')) loop
      mi := mi + 1;
      if m->>'preleve' = 'true' and coalesce(nullif(m->>'eprNombre',''),'0')::int > 0 then
        prels := prels || jsonb_build_array(jsonb_build_object('nombre',(m->>'eprNombre')::int,'type',case when m->>'eprCylindre'='true' then 'cylindre' else 'cube' end,'malaxeur',mi));
      end if;
    end loop;
  end if;
  for pr in select value from jsonb_array_elements(prels) loop
    ei := ei + 1; n := coalesce(nullif(pr->>'nombre',''),'0')::int;
    if n < 0 or n > 1000 then raise exception 'nombre_prelevement_invalide'; end if;
    for j in 1..n loop
      out_codes := out_codes || jsonb_build_array(jsonb_build_object('code',p_ref||'-E'||ei||'-'||case when j<10 then '0'||j else j::text end,
        'prel',ei,'numInterne',j,'type',coalesce(pr->>'type','cube'),'malaxeur',pr->'malaxeur'));
    end loop;
  end loop;
  return out_codes;
end; $$;

create or replace function public._code_text(p jsonb)
returns text language sql immutable as $$ select case when jsonb_typeof(p)='string' then p#>>'{}' else p->>'code' end $$;

create or replace function public._lot_codes_valides(p jsonb, n int, essais jsonb default null)
returns boolean language plpgsql immutable set search_path = public as $$
declare cs text[]; es text[];
begin
  if jsonb_typeof(p) is distinct from 'array' or n is null or n <= 0 then return false; end if;
  select array_agg(public._code_text(value) order by public._code_text(value)) into cs from jsonb_array_elements(p);
  if coalesce(cardinality(cs),0) <> n or exists(select 1 from unnest(cs) c where c is null or c='')
    or (select count(distinct c) from unnest(cs) c) <> n then return false; end if;
  if essais is not null then
    if jsonb_typeof(essais) is distinct from 'array' then return false; end if;
    select array_agg(value->>'code' order by value->>'code') into es from jsonb_array_elements(essais);
    if es is distinct from cs then return false; end if;
    if exists(select 1 from jsonb_array_elements(essais) e where
      coalesce(nullif(e->>'dim1',''),nullif(e->>'d1',''),'0')::numeric <= 0 or
      coalesce(nullif(e->>'dim2',''),nullif(e->>'d2',''),'0')::numeric <= 0 or
      coalesce(e->>'dateEssai','') = '' or
      (coalesce(nullif(e->>'force',''),'0')::numeric <= 0 and coalesce(nullif(e->>'rc',''),'0')::numeric <= 0)) then return false; end if;
  end if;
  return true;
exception when invalid_text_representation then return false;
end; $$;

-- Stable across JSON key order; timestamp changes detect concurrent drafts too.
create or replace function public._repartition_snapshot(p_ref text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('lotKey',lot_key,'updatedAt',updated_at) order by lot_key),'[]')
  from public.lots where coulage_ref=p_ref;
$$;

create or replace function public.op_replace_repartition(p_token text,p_ref text,p_lots jsonb,p_expected jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; l jsonb; cs jsonb; expected_codes text[]; actual_codes text[]; k text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok',false,'error','auth'); end if;
  select * into c from public.coulages where ref=p_ref for update;
  if not found then return json_build_object('ok',false,'error','coulage_introuvable'); end if;
  if not (public._admin_can(p_token,c.labo_id) or (r.is_admin is not true and r.labo_id=c.labo_id)) then
    return json_build_object('ok',false,'error','autre_labo'); end if;
  perform 1 from public.lots where coulage_ref=p_ref for update;
  if public._repartition_snapshot(p_ref) is distinct from p_expected then
    return json_build_object('ok',false,'error','conflit_repartition'); end if;
  if exists(select 1 from public.lots where coulage_ref=p_ref and statut <> 'en_bassin') then
    return json_build_object('ok',false,'error','lots_engages'); end if;
  cs := public._repartition_codes(p_ref,c.payload);
  select array_agg(value->>'code' order by value->>'code') into expected_codes from jsonb_array_elements(cs);
  select array_agg(public._code_text(x) order by public._code_text(x)) into actual_codes
    from jsonb_array_elements(p_lots) v cross join lateral jsonb_array_elements(v->'codes') x;
  if expected_codes is null or expected_codes is distinct from actual_codes then
    return json_build_object('ok',false,'error','repartition_incomplete'); end if;
  for l in select value from jsonb_array_elements(p_lots) loop
    if not public._lot_codes_valides(l->'codes',(l->>'nombre')::int) or coalesce((l->>'ageJours')::int,0)<=0 then
      return json_build_object('ok',false,'error','repartition_incomplete'); end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_lots) a group by a->>'ageJours' having count(*)>1) then
    return json_build_object('ok',false,'error','echeance_double'); end if;
  -- Snapshot journalisé avant remplacement, dans la même transaction.
  insert into public.lot_corrections_historique(lot_key,coulage_ref,auteur,motif,avant,apres)
    select 'repartition',p_ref,r.nom,'Répartition complète',coalesce(jsonb_agg(to_jsonb(t)),'[]'),p_lots from public.lots t where coulage_ref=p_ref;
  delete from public.lots where coulage_ref=p_ref;
  for l in select value from jsonb_array_elements(p_lots) loop
    k := p_ref||'-L'||gen_random_uuid();
    l := (l - 'id') || jsonb_build_object('ref',p_ref,'lotKey',k,'statut','en_bassin','integriteVersion',1,'correctionRevision',0,
      'dateCoulage',c.payload->>'dateCoulage','datePrevue',nullif(c.payload->>'dateCoulage','')::date+(l->>'ageJours')::int);
    insert into public.lots(lot_key,coulage_ref,labo_id,prel,type,age_jours,nombre,codes,date_coulage,date_echeance,statut,payload)
      values(k,p_ref,c.labo_id,coalesce((l->>'prel')::int,1),coalesce(l->>'type','cube'),(l->>'ageJours')::int,
        (l->>'nombre')::int,l->'codes',nullif(c.payload->>'dateCoulage','')::date,
        nullif(c.payload->>'dateCoulage','')::date+(l->>'ageJours')::int,'en_bassin',l);
  end loop;
  update public.coulages set payload=payload||jsonb_build_object('bassinReparti',true,'dateRepartition',now()),updated_at=now() where ref=p_ref;
  return json_build_object('ok',true);
end; $$;

-- Complément additif : aucun code ni résultat déjà présent ne peut être retiré.
-- Le paramètre p_prelevement est réservé au responsable et corrige uniquement
-- le nombre d'un malaxeur existant (les anciens E gardent leur identité).
create or replace function public.op_completer_lot(p_token text,p_key text,p_codes jsonb,p_motif text,p_revision int,p_prelevement jsonb default null)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; l public.lots; inventory jsonb; selected jsonb;
  admin_ok boolean; n int; mi int; m jsonb; old_payload jsonb; np jsonb; clean_essais jsonb; rev int;
begin
  r := public._op_by_token(p_token);
  -- Bureau : la clé service_role est gardée exclusivement sur le poste Python.
  admin_ok := coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')='service_role';
  if r.id is null and not admin_ok then return json_build_object('ok',false,'error','auth'); end if;
  select * into l from public.lots where lot_key=p_key;
  if not found then return json_build_object('ok',false,'error','introuvable'); end if;
  select * into c from public.coulages where ref=l.coulage_ref for update;
  perform 1 from public.lots where coulage_ref=c.ref for update;
  select * into l from public.lots where lot_key=p_key;
  admin_ok := admin_ok or public._admin_can(p_token,l.labo_id);
  if not coalesce(admin_ok or (r.is_admin is not true and r.labo_id=l.labo_id),false) then return json_build_object('ok',false,'error','autre_labo'); end if;
  if length(trim(coalesce(p_motif,'')))<3 then return json_build_object('ok',false,'error','motif_requis'); end if;
  rev := coalesce((l.payload->>'correctionRevision')::int,0);
  if p_revision is distinct from rev then return json_build_object('ok',false,'error','conflit_revision'); end if;
  if l.statut='valide' and not admin_ok then return json_build_object('ok',false,'error','admin'); end if;
  old_payload := c.payload;
  if p_prelevement is not null then
    if not admin_ok then return json_build_object('ok',false,'error','admin'); end if;
    mi := (p_prelevement->>'malaxeur')::int-1; n := (p_prelevement->>'nombre')::int;
    m := c.payload->'malaxeurs'->mi;
    if mi is null or mi<0 or m is null or m->>'preleve' is distinct from 'true' or n is null or n>1000 or
      n<=coalesce(nullif(m->>'prelNombre',''),'0')::int or coalesce(nullif(m->>'prelNombre',''),'0')::int<=0 then
      return json_build_object('ok',false,'error','prelevement_invalide'); end if;
    c.payload := jsonb_set(c.payload,array['malaxeurs',mi::text,'prelNombre'],to_jsonb(n));
    c.payload := c.payload || jsonb_build_object('prelevementCorrectionRevision',c.version+1);
  end if;
  inventory := public._repartition_codes(c.ref,c.payload);
  if jsonb_typeof(p_codes) is distinct from 'array' then return json_build_object('ok',false,'error','codes_invalides'); end if;
  n := jsonb_array_length(p_codes);
  if not public._lot_codes_valides(p_codes,n) then return json_build_object('ok',false,'error','codes_invalides'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(l.codes,'[]')) x where not exists(
    select 1 from jsonb_array_elements(p_codes) y where public._code_text(x)=public._code_text(y))) then
    return json_build_object('ok',false,'error','retrait_interdit'); end if;
  if n<=jsonb_array_length(coalesce(l.codes,'[]')) then return json_build_object('ok',false,'error','sans_ajout'); end if;
  if exists(select 1 from jsonb_array_elements(p_codes) x where not exists(
    select 1 from jsonb_array_elements(inventory) y where public._code_text(x)=y->>'code')) then
    return json_build_object('ok',false,'error','code_inconnu'); end if;
  if exists(select 1 from public.lots t cross join lateral jsonb_array_elements(t.codes) x
    where t.coulage_ref=c.ref and t.lot_key is distinct from p_key and exists(
      select 1 from jsonb_array_elements(p_codes) y where public._code_text(x)=public._code_text(y))) then
    return json_build_object('ok',false,'error','code_occupe'); end if;
  select jsonb_agg(i order by ord) into selected from jsonb_array_elements(p_codes) with ordinality s(x,ord)
    join jsonb_array_elements(inventory) i on i->>'code'=public._code_text(x);
  select coalesce(jsonb_agg(e - 'valideeIngenieur' - 'approuveeResponsable'),'[]') into clean_essais
    from jsonb_array_elements(coalesce(l.payload->'essais','[]')) e;
  np := (coalesce(l.payload,'{}') - 'resultatsValidesPar' - 'resultatsValidesLe' - 'dateValidationResultats' - 'approuveResponsable') ||
    jsonb_build_object('codes',selected,'nombre',n,'essais',clean_essais,'resultatsValides',false,
      'statut',case when l.statut='en_bassin' then 'en_bassin' else 'sorti' end,
      'integriteVersion',1,'correctionRevision',rev+1,'correctionEnAttente',not admin_ok,
      'dechetsDejaComptes',greatest(coalesce((l.payload->>'dechetsDejaComptes')::int,0),case when l.statut in ('teste','valide') then l.nombre else 0 end),
      'correctionMotif',trim(p_motif),'correctionAuteur',coalesce(r.nom,'Bureau responsable'),'correctionDate',now());
  insert into public.lot_corrections_historique(lot_key,coulage_ref,auteur,motif,avant,apres)
    values(p_key,c.ref,coalesce(r.nom,'Bureau responsable'),trim(p_motif),jsonb_build_object('lot',to_jsonb(l),'coulage',old_payload),jsonb_build_object('lot',np,'coulage',c.payload));
  update public.lots set nombre=n,codes=selected,payload=np,statut=np->>'statut',resultats=clean_essais,
    resultats_valides_par=null,resultats_valides_at=null,updated_at=now() where lot_key=p_key;
  if c.payload is distinct from old_payload then
    update public.coulages set payload=c.payload,version=version+1,updated_at=now() where ref=c.ref;
  end if;
  return json_build_object('ok',true,'pending',not admin_ok,'nombre',n,'revision',rev+1);
end; $$;

create or replace function public.op_approuver_complement(p_token text,p_key text,p_revision int)
returns json language plpgsql security definer set search_path = public as $$
declare l public.lots; r public.operators;
begin
  r:=public._op_by_token(p_token);
  select * into l from public.lots where lot_key=p_key for update;
  if not found then return json_build_object('ok',false,'error','introuvable'); end if;
  if not public._admin_can(p_token,l.labo_id) then return json_build_object('ok',false,'error','admin'); end if;
  if p_revision is distinct from coalesce((l.payload->>'correctionRevision')::int,0) then return json_build_object('ok',false,'error','conflit_revision'); end if;
  insert into public.lot_corrections_historique(lot_key,coulage_ref,auteur,motif,avant,apres)
    values(p_key,l.coulage_ref,r.nom,'Autorisation du complément',l.payload,l.payload||jsonb_build_object('correctionEnAttente',false));
  update public.lots set payload=payload||jsonb_build_object('correctionEnAttente',false,'complementApprouvePar',r.nom,'complementApprouveLe',now(),
    'correctionRevision',p_revision+1),updated_at=now() where lot_key=p_key;
  return json_build_object('ok',true);
end; $$;

-- Validation explicite du complément saisi depuis le poste Bureau.
create or replace function public.bureau_valider_complement(p_key text,p_revision int,p_essais jsonb,p_auteur text,p_operateur text)
returns json language plpgsql security definer set search_path=public as $$
declare l public.lots; np jsonb;
begin
  if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','')<>'service_role' then
    return json_build_object('ok',false,'error','admin'); end if;
  select * into l from public.lots where lot_key=p_key for update;
  if not found then return json_build_object('ok',false,'error','introuvable'); end if;
  if p_revision is distinct from coalesce((l.payload->>'correctionRevision')::int,0) or p_revision<=0 then
    return json_build_object('ok',false,'error','conflit_revision'); end if;
  if l.statut not in ('sorti','teste') then return json_build_object('ok',false,'error','statut'); end if;
  if length(trim(coalesce(p_auteur,'')))<2 or length(trim(coalesce(p_operateur,'')))<2 then
    return json_build_object('ok',false,'error','auteur_operateur_requis'); end if;
  if not public._lot_codes_valides(l.codes,l.nombre,p_essais) then return json_build_object('ok',false,'error','essais_incoherents'); end if;
  np := l.payload || jsonb_build_object('essais',p_essais,'statut','valide','resultatsValides',true,'resultatsValidesPar',trim(p_auteur),
    'resultatsValidesLe',now(),'approuveResponsable',true,'correctionEnAttente',false,'correctionRevision',p_revision+1,
    'dateEssai',p_essais->0->>'dateEssai','operateurEssai',trim(p_operateur));
  insert into public.lot_corrections_historique(lot_key,coulage_ref,auteur,motif,avant,apres)
    values(p_key,l.coulage_ref,trim(p_auteur),'Validation des essais complémentaires au bureau',to_jsonb(l),np);
  update public.lots set payload=np,resultats=p_essais,statut='valide',ecrase_par=trim(p_operateur),
    resultats_valides_par=trim(p_auteur),resultats_valides_at=now(),updated_at=now() where lot_key=p_key;
  return json_build_object('ok',true);
end; $$;
revoke all on function public.bureau_valider_complement(text,int,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.bureau_valider_complement(text,int,jsonb,text,text) to service_role;

-- Le chemin historique reste utilisé pour les brouillons et essais, mais ne
-- peut ni fabriquer un lot isolé ni modifier une identité ou une autorisation.
do $$ begin
  if to_regprocedure('public._op_upsert_lot_avant_integrite(text,text,jsonb)') is null then
    alter function public.op_upsert_lot(text,text,jsonb) rename to _op_upsert_lot_avant_integrite;
  end if;
end $$;
revoke all on function public._op_upsert_lot_avant_integrite(text,text,jsonb) from public,anon,authenticated;
create or replace function public.op_upsert_lot(p_token text,p_key text,p_lot jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare l public.lots; r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok',false,'error','auth'); end if;
  select * into l from public.lots where lot_key=p_key for update;
  if not found then return json_build_object('ok',false,'error','mise_a_jour_requise'); end if;
  if not (public._admin_can(p_token,l.labo_id) or (r.is_admin is not true and r.labo_id=l.labo_id)) then
    return json_build_object('ok',false,'error','autre_labo'); end if;
  if coalesce((p_lot->>'correctionRevision')::int,0) <> coalesce((l.payload->>'correctionRevision')::int,0) then
    return json_build_object('ok',false,'error','conflit_revision'); end if;
  if p_lot->>'ref' is distinct from l.coulage_ref or p_lot->'codes' is distinct from l.payload->'codes'
    or p_lot->'nombre' is distinct from l.payload->'nombre' or p_lot->'ageJours' is distinct from l.payload->'ageJours' then
    return json_build_object('ok',false,'error','correction_controlee_requise'); end if;
  if p_lot->>'statut'='valide' and l.statut<>'valide' then return json_build_object('ok',false,'error','admin'); end if;
  p_lot := (p_lot - 'approuveResponsable' - 'resultatsValidesPar' - 'resultatsValidesLe') || jsonb_build_object('correctionEnAttente',coalesce((l.payload->>'correctionEnAttente')::boolean,false),
    'integriteVersion',coalesce((l.payload->>'integriteVersion')::int,0),'resultatsValides',l.statut='valide');
  return public._op_upsert_lot_avant_integrite(p_token,p_key,p_lot);
end; $$;

-- Toutes les voies de publication (y compris les anciennes RPC) passent ici.
create or replace function public._controle_essais_lot()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.statut in ('teste','valide') then
    if not public._lot_codes_valides(new.codes,new.nombre,coalesce(new.payload->'essais',new.resultats,'[]')) then
      raise exception 'essais_incoherents'; end if;
    if new.statut='valide' and coalesce((new.payload->>'correctionEnAttente')::boolean,false) then
      raise exception 'correction_en_attente'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists controle_essais_lot on public.lots;
create trigger controle_essais_lot before insert or update on public.lots for each row execute function public._controle_essais_lot();

-- Les anciennes voies de répartition non atomiques ne doivent pas contourner
-- les contrôles. Suppression opérationnelle : uniquement via remplacement.
create or replace function public.op_save_repartition(p_token text,p_ref text,p_lots jsonb)
returns json language sql as $$ select json_build_object('ok',false,'error','mise_a_jour_requise') $$;
create or replace function public.op_delete_lot(p_token text,p_key text)
returns json language sql as $$ select json_build_object('ok',false,'error','mise_a_jour_requise') $$;

revoke all on function public._repartition_codes(text,jsonb),public._code_text(jsonb),public._lot_codes_valides(jsonb,int,jsonb),public._repartition_snapshot(text),public._controle_essais_lot() from public,anon,authenticated;
revoke all on function public.op_replace_repartition(text,text,jsonb,jsonb),public.op_completer_lot(text,text,jsonb,text,int,jsonb),public.op_approuver_complement(text,text,int),public.op_upsert_lot(text,text,jsonb) from public;
grant execute on function public.op_replace_repartition(text,text,jsonb,jsonb),public.op_completer_lot(text,text,jsonb,text,int,jsonb),public.op_approuver_complement(text,text,int),public.op_upsert_lot(text,text,jsonb) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
