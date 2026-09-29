// ============================================================================
//  CAEK — Module Béton (Phase 4 B3) : Edge Function « media-access »
//
//  Remplace l'accès Storage `select anon` (fermé par la migration Phase 4).
//  Téléverse un média ou délivre une URL SIGNÉE À DURÉE LIMITÉE, uniquement si :
//    1. le jeton opérateur est valide (op_verify) ;
//    2. l'opérateur appartient au laboratoire du coulage ;
//    3. le média appartient bien à ce coulage.
//  La clé service_role reste STRICTEMENT côté serveur (jamais renvoyée, jamais
//  journalisée). La réponse ne contient qu'une URL signée de courte durée.
//
//  Déploiement :  supabase functions deploy media-access --no-verify-jwt
//  Secrets requis (supabase secrets set ...) : SB_URL, SB_SERVICE_ROLE
//
//  Lecture : { action:"read", token, coulageRef, mediaUuid }
//  Upload : { action:"upload", token, coulageRef, mediaUuid,
//             storagePath, mime, taille, base64 }
//  Réponse : { ok:true, url, expiresIn } | { ok:false, error }
// ============================================================================
function cleanEnv(name: string, fallback = "") {
  return (Deno.env.get(name) || fallback).trim().replace(/^["']|["']$/g, "");
}
const SB_URL = cleanEnv("SB_URL");
const SB_SERVICE_ROLE = cleanEnv("SB_SERVICE_ROLE");
const BUCKET = "medias";
const SIGNED_TTL = 120; // secondes — accès temporaire uniquement

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "audio/webm", "audio/mp4",
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/aac", "audio/3gpp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

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
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }
  if (req.method !== "POST") {
    return response({ ok: false, error: "method" }, 405);
  }
  try {
    const body = await req.json();
    const { token, coulageRef, mediaUuid } = body;
    if (!token || !coulageRef || !mediaUuid) {
      return response({ ok: false, error: "parametres" }, 400);
    }

    // 1. Jeton opérateur valide + labo de l'opérateur.
    const verify = await rest("rpc/op_verify", {
      method: "POST", body: JSON.stringify({ p_token: token }),
    });
    if (!verify || verify.ok !== true) {
      return response({ ok: false, error: "auth" }, 401);
    }

    // 2/3. Le coulage existe, et l'opérateur a le droit sur son labo ; le
    // média appartient bien à ce coulage.
    const coulages = await rest(
      `coulages?select=labo_id&ref=eq.${encodeURIComponent(coulageRef)}`);
    if (!coulages || !coulages.length) {
      return response({ ok: false, error: "coulage_introuvable" }, 404);
    }
    const laboCoulage = coulages[0].labo_id;
    const isPrincipal = verify.is_admin === true &&
      (!verify.admin_labos || verify.admin_labos.length === 0);
    const scoped = verify.is_admin === true
      ? (isPrincipal || (verify.admin_labos || []).includes(laboCoulage))
      : verify.labo_id === laboCoulage;
    if (!scoped) {
      return response({ ok: false, error: "autre_labo" }, 403);
    }

    if (body.action === "upload") {
      const storagePath = String(body.storagePath || "");
      const numeroEchantillon = String(body.numeroEchantillon || "").trim();
      const mime = String(body.mime || "").split(";")[0].toLowerCase();
      const declaredSize = Number(body.taille || 0);
      const expectedPrefix = `coulages/${coulageRef}/`;
      if (!storagePath.startsWith(expectedPrefix) || !storagePath.includes(String(mediaUuid)) ||
          !ALLOWED_MIME.has(mime) || !body.base64 || numeroEchantillon.length > 120) {
        return response({ ok: false, error: "media_invalide" }, 400);
      }
      const binary = atob(String(body.base64));
      if (binary.length > MAX_BYTES || declaredSize > MAX_BYTES) {
        return response({ ok: false, error: "media_trop_volumineux" }, 413);
      }
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const upload = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
        method: "POST",
        headers: {
          apikey: SB_SERVICE_ROLE, Authorization: `Bearer ${SB_SERVICE_ROLE}`,
          "Content-Type": mime, "x-upsert": "true",
        },
        body: bytes,
      });
      if (!upload.ok) { return response({ ok: false, error: "upload_impossible" }, 502); }
      await rest("media_assets?on_conflict=uuid", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          uuid: mediaUuid, coulage_ref: coulageRef, storage_path: storagePath,
          mime, taille: bytes.length, numero_echantillon: numeroEchantillon,
          upload_state: "uploaded",
        }),
      });
      return response({ ok: true, uuid: mediaUuid, storagePath });
    }

    const medias = await rest(
      `media_assets?select=storage_path&uuid=eq.${encodeURIComponent(mediaUuid)}` +
      `&coulage_ref=eq.${encodeURIComponent(coulageRef)}`);
    if (!medias || !medias.length) {
      return response({ ok: false, error: "media_introuvable" }, 404);
    }
    const storagePath = medias[0].storage_path;

    // URL signée à durée limitée (service_role, jamais exposée au client).
    const signRes = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
      method: "POST",
      headers: {
        apikey: SB_SERVICE_ROLE, Authorization: `Bearer ${SB_SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: SIGNED_TTL }),
    });
    const signed = signRes.ok ? await signRes.json() : null;
    const url = signed && signed.signedURL
      ? `${SB_URL}/storage/v1${signed.signedURL}` : null;
    if (!url) {
      return response({ ok: false, error: "signature_impossible" }, 500);
    }
    return response({ ok: true, url, expiresIn: SIGNED_TTL });
  } catch (_e) {
    // Jamais de détail interne (pas de fuite service_role dans les logs).
    return response({ ok: false, error: "interne" }, 500);
  }
});
