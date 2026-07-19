// ============================================================================
//  CAEK — Module Béton (Phase 4 B3) : Edge Function « media-access »
//
//  Remplace l'accès Storage `select anon` (fermé par la migration Phase 4).
//  Délivre une URL SIGNÉE À DURÉE LIMITÉE pour un média, uniquement si :
//    1. le jeton opérateur est valide (op_verify) ;
//    2. l'opérateur appartient au laboratoire du coulage ;
//    3. le média appartient bien à ce coulage.
//  La clé service_role reste STRICTEMENT côté serveur (jamais renvoyée, jamais
//  journalisée). La réponse ne contient qu'une URL signée de courte durée.
//
//  Déploiement :  supabase functions deploy media-access --no-verify-jwt
//  Secrets requis (supabase secrets set ...) : SB_URL, SB_SERVICE_ROLE
//
//  Requête (POST JSON) : { token, coulageRef, mediaUuid }
//  Réponse : { ok:true, url, expiresIn } | { ok:false, error }
// ============================================================================
function cleanEnv(name: string, fallback = "") {
  return (Deno.env.get(name) || fallback).trim().replace(/^["']|["']$/g, "");
}
const SB_URL = cleanEnv("SB_URL");
const SB_SERVICE_ROLE = cleanEnv("SB_SERVICE_ROLE");
const BUCKET = "medias";
const SIGNED_TTL = 120; // secondes — accès temporaire uniquement

const jsonHeaders = { "Content-Type": "application/json" };

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SERVICE_ROLE,
      Authorization: `Bearer ${SB_SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`rest ${path} ${res.status}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method" }), {
      status: 405, headers: jsonHeaders,
    });
  }
  try {
    const { token, coulageRef, mediaUuid } = await req.json();
    if (!token || !coulageRef || !mediaUuid) {
      return new Response(JSON.stringify({ ok: false, error: "parametres" }),
        { status: 400, headers: jsonHeaders });
    }

    // 1. Jeton opérateur valide + labo de l'opérateur.
    const verify = await rest("rpc/op_verify", {
      method: "POST", body: JSON.stringify({ p_token: token }),
    });
    if (!verify || verify.ok !== true) {
      return new Response(JSON.stringify({ ok: false, error: "auth" }),
        { status: 401, headers: jsonHeaders });
    }

    // 2/3. Le coulage existe, et l'opérateur a le droit sur son labo ; le
    // média appartient bien à ce coulage.
    const coulages = await rest(
      `coulages?select=labo_id&ref=eq.${encodeURIComponent(coulageRef)}`);
    if (!coulages || !coulages.length) {
      return new Response(JSON.stringify({ ok: false, error: "coulage_introuvable" }),
        { status: 404, headers: jsonHeaders });
    }
    const laboCoulage = coulages[0].labo_id;
    const isPrincipal = verify.is_admin === true &&
      (!verify.admin_labos || verify.admin_labos.length === 0);
    const scoped = verify.is_admin === true
      ? (isPrincipal || (verify.admin_labos || []).includes(laboCoulage))
      : verify.labo_id === laboCoulage;
    if (!scoped) {
      return new Response(JSON.stringify({ ok: false, error: "autre_labo" }),
        { status: 403, headers: jsonHeaders });
    }

    const medias = await rest(
      `media_assets?select=storage_path&uuid=eq.${encodeURIComponent(mediaUuid)}` +
      `&coulage_ref=eq.${encodeURIComponent(coulageRef)}`);
    if (!medias || !medias.length) {
      return new Response(JSON.stringify({ ok: false, error: "media_introuvable" }),
        { status: 404, headers: jsonHeaders });
    }
    const storagePath = medias[0].storage_path;

    // URL signée à durée limitée (service_role, jamais exposée au client).
    const signed = await rest(
      `../storage/v1/object/sign/${BUCKET}/${storagePath}`.replace("rest/v1/../", ""),
      { method: "POST", body: JSON.stringify({ expiresIn: SIGNED_TTL }) },
    ).catch(() => null);
    // La forme exacte de l'endpoint sign varie ; on documente le contrat.
    const url = signed && signed.signedURL
      ? `${SB_URL}/storage/v1${signed.signedURL}` : null;
    if (!url) {
      return new Response(JSON.stringify({ ok: false, error: "signature_impossible" }),
        { status: 500, headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ ok: true, url, expiresIn: SIGNED_TTL }),
      { status: 200, headers: jsonHeaders });
  } catch (_e) {
    // Jamais de détail interne (pas de fuite service_role dans les logs).
    return new Response(JSON.stringify({ ok: false, error: "interne" }),
      { status: 500, headers: jsonHeaders });
  }
});
