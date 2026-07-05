// ============================================================================
//  CAEK — Module Béton (V3) : Edge Function « send-push »
//  Envoie les notifications 'pending' de la table public.notifications aux
//  abonnements Web Push (VAPID). Invoquée périodiquement par pg_cron.
//
//  Déploiement (voir GUIDE_NOTIFICATIONS.md) :
//    supabase functions deploy send-push --no-verify-jwt
//  Secrets requis (supabase secrets set ...) :
//    SB_URL, SB_SERVICE_ROLE, VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT
// ============================================================================
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SB_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SB_SERVICE_ROLE")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:caek.engineering@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Appel REST avec la clé service_role (contourne RLS).
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
  if (!res.ok) throw new Error(`REST ${path} ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Abonnements destinataires selon la cible ('admins' | 'labo:<uuid>').
async function subsForCible(cible: string) {
  let opFilter = "";
  if (cible === "admins") {
    opFilter = "is_admin=eq.true";
  } else if (cible.startsWith("labo:")) {
    opFilter = `labo_id=eq.${cible.slice(5)}`;
  } else {
    return [];
  }
  const ops = await rest(`operators?select=id&actif=eq.true&${opFilter}`);
  const ids = (ops as any[]).map((o) => o.id);
  if (!ids.length) return [];
  const inList = `(${ids.join(",")})`;
  return await rest(
    `push_subscriptions?select=id,endpoint,p256dh,auth&operator_id=in.${inList}`,
  ) as any[];
}

Deno.serve(async () => {
  try {
    const pending = await rest(
      "notifications?select=*&statut=eq.pending&order=created_at.asc&limit=50",
    ) as any[];

    let sent = 0, failed = 0;
    for (const n of pending) {
      const subs = await subsForCible(n.cible);
      const payload = JSON.stringify({
        title: n.titre, body: n.corps, url: n.url || "/", tag: n.tag || "",
      });
      for (const s of subs) {
        const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        try {
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (e) {
          failed++;
          // Abonnement expiré (404/410) : on le supprime.
          const code = (e as any)?.statusCode;
          if (code === 404 || code === 410) {
            await rest(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" });
          }
        }
      }
      await rest(`notifications?id=eq.${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({ statut: "sent", sent_at: new Date().toISOString() }),
      });
    }
    return new Response(JSON.stringify({ ok: true, notifications: pending.length, sent, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
