/* ============================================================
   Module Béton - CAEK
   operateurs.js - V3 : connexion SERVEUR + administration.

   Remplace le système local V2.06 (liste d'opérateurs locale) :
   - Connexion identifiant + PIN vérifiée sur le serveur (op_login).
   - Session en localStorage { token, identifiant, nom, fonction,
     is_admin, labo_id, labo_nom } : une fois connecté, l'app
     fonctionne HORS-LIGNE (le token est revérifié quand le réseau
     revient ; une désactivation par l'admin force la déconnexion).
   - Rôles : admin | operateur (le rôle "chef" V2.06 est abandonné).
   - Multi-labos : chaque opérateur est affecté à un laboratoire
     (bassin + machine d'écrasement) ; l'admin gère les labos et les
     opérateurs depuis l'écran Administration (RPC admin_*).
   - Le PIN n'est JAMAIS stocké : vérification serveur (sha256).
   ============================================================ */
var CAEKOperateurs = (function () {
  "use strict";

  var LS_SESSION = "caek_session";

  var ROLE_LABEL = { operateur: "Opérateur", admin: "Administrateur" };

  var _session = undefined;   // objet session ou null
  var _editing = null;        // id opérateur en cours d'édition
  var _editingLabo = null;    // id labo en cours d'édition
  var _ops = [];              // cache liste opérateurs (admin)
  var _labos = [];            // cache liste labos (admin)

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function val(id) { var e = $(id); return e ? e.value : ""; }
  function clearVal() { for (var i = 0; i < arguments.length; i++) { var e = $(arguments[i]); if (e) { e.value = ""; } } }
  function isValidPin(pin) { return /^[0-9]{4,6}$/.test(String(pin || "")); }

  /* ---------- Session ---------- */
  function readSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION)); } catch (e) { return null; }
  }
  function writeSession(s) {
    try {
      if (s) { localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
      else { localStorage.removeItem(LS_SESSION); }
    } catch (e) {}
  }
  function session() {
    if (_session === undefined) { _session = readSession(); }
    return _session;
  }
  function token() { var s = session(); return s ? s.token : null; }
  function isLogged() { var s = session(); return !!(s && s.token); }
  function getActive() {
    var s = session();
    return s ? { username: s.identifiant, nom: s.nom, qualification: s.fonction || "",
      role: s.is_admin ? "admin" : "operateur" } : null;
  }
  function activeUsername() { var s = session(); return s ? s.identifiant : null; }
  function role() { var s = session(); return s ? (s.is_admin ? "admin" : "operateur") : null; }
  function isAdmin() { return role() === "admin"; }
  function canSupervise() { return isAdmin(); }
  function laboId() { var s = session(); return s ? (s.labo_id || null) : null; }
  function laboNom() { var s = session(); return s ? (s.labo_nom || "") : ""; }
  // Ensemble de labos qu'un admin peut vérifier. null/[] = admin PRINCIPAL (tous).
  function adminLabos() {
    var s = session();
    return (s && Array.isArray(s.admin_labos) && s.admin_labos.length) ? s.admin_labos : null;
  }
  // Admin principal : admin sans restriction de labos.
  function isPrincipal() { return isAdmin() && adminLabos() === null; }

  // Cases à cocher « laboratoires vérifiés » (droits admin par labo).
  function laboCheckboxes(selected, cls) {
    var sel = selected || [];
    return _labos.map(function (b) {
      var on = sel.indexOf(b.id) >= 0 ? " checked" : "";
      return "<label class=\"oper-labo-check\"><input type=\"checkbox\" class=\"" + cls +
        "\" value=\"" + escapeHtml(b.id) + "\"" + on + "> " + escapeHtml(b.nom) + "</label>";
    }).join("");
  }
  function readChecked(scope, cls) {
    var out = [];
    (scope || document).querySelectorAll("." + cls + ":checked").forEach(function (c) { out.push(c.value); });
    return out;
  }

  function requireAdmin(label) {
    if (isAdmin()) { return true; }
    if (window.alert) { window.alert("Action réservée à l'administrateur" + (label ? " : " + label : "") + "."); }
    return false;
  }

  /* ---------- Activation / rôle ---------- */
  function applyActive() {
    var s = session();
    if (window.CAEKProfil) {
      if (s) {
        var qualif = s.fonction || "";
        if (s.labo_nom) { qualif = qualif ? (qualif + " · " + s.labo_nom) : s.labo_nom; }
        CAEKProfil.save(s.nom, qualif, s.identifiant);
      } else {
        CAEKProfil.clear();
      }
    }
    applyRoleClass();
  }
  function applyRoleClass() {
    if (!document.body) { return; }
    var cl = document.body.classList;
    cl.remove("is-admin", "is-chef", "is-operateur");
    var r = role();
    if (r === "admin") { cl.add("is-admin"); }
    else if (r === "operateur") { cl.add("is-operateur"); }
    applyAdminVisibility();
  }
  function applyAdminVisibility() {
    var admin = isAdmin();
    var els = document.querySelectorAll(".admin-only");
    for (var i = 0; i < els.length; i++) { els[i].hidden = !admin; }
    // Fonctions réservées à l'ADMIN PRINCIPAL (gestion opérateurs/labos) :
    // masquées pour un admin de validation scopé, qui ne les voit même pas.
    var principal = isPrincipal();
    var pels = document.querySelectorAll(".principal-only");
    for (var j = 0; j < pels.length; j++) { pels[j].hidden = !principal; }
  }

  /* ---------- Connexion / déconnexion ---------- */
  var LOGIN_ERRORS = {
    identifiant: "Identifiant inconnu.",
    inactif: "Compte désactivé : contactez l'administrateur.",
    pin: "Code PIN incorrect."
  };

  function login(identifiant, pin) {
    identifiant = String(identifiant || "").trim();
    if (!identifiant) { return Promise.resolve({ ok: false, error: "Saisissez votre identifiant." }); }
    if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
    if (!window.CAEKServer || !CAEKServer.configured()) {
      return Promise.resolve({ ok: false, error: "Serveur non configuré (js/config.js)." });
    }
    return CAEKServer.login(identifiant, pin).then(function (r) {
      if (!r || r.ok !== true) {
        return { ok: false, error: LOGIN_ERRORS[r && r.error] || "Connexion refusée." };
      }
      _session = {
        token: r.token, identifiant: r.identifiant, nom: r.nom,
        fonction: r.fonction || "", is_admin: r.is_admin === true,
        labo_id: r.labo_id || null, labo_nom: r.labo_nom || "",
        admin_labos: r.admin_labos || null   // null/[] = admin principal (tous)
      };
      writeSession(_session);
      applyActive();
      renderAll();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
      return { ok: true };
    }).catch(function (e) {
      var reseau = e && (e.name === "NetworkError" || /network|fetch/i.test(e.message || ""));
      return { ok: false, error: reseau
        ? "Connexion impossible : vérifiez le réseau (la 1ʳᵉ connexion nécessite Internet)."
        : ("Erreur serveur : " + (e && e.message || "")) };
    });
  }

  function logout() {
    _session = null;
    writeSession(null);
    if (window.CAEKProfil) { CAEKProfil.clear(); }
    applyRoleClass();
    renderAll();
    if (window.CAEKApp) { CAEKApp.navigate("screen-login"); }
  }

  // Revérifie la session quand le réseau est disponible : met à jour
  // nom/rôle/labo (l'admin a pu réaffecter l'opérateur) ; déconnecte si
  // le compte a été désactivé. Une erreur RÉSEAU ne déconnecte pas
  // (fonctionnement hors-ligne).
  function verifyOnline() {
    var s = session();
    if (!s || !window.CAEKServer || !CAEKServer.configured()) { return Promise.resolve(); }
    return CAEKServer.verify(s.token).then(function (r) {
      if (r && r.ok === true) {
        s.nom = r.nom; s.identifiant = r.identifiant;
        s.is_admin = r.is_admin === true;
        s.labo_id = r.labo_id || null; s.labo_nom = r.labo_nom || "";
        s.admin_labos = r.admin_labos || null;
        _session = s; writeSession(s);
        applyActive();
        renderAll();
      } else if (r && r.ok === false) {
        if (window.alert) { window.alert("Session expirée ou compte désactivé : reconnectez-vous."); }
        logout();
      }
    }).catch(function () { /* hors-ligne : on garde la session */ });
  }

  // L'utilisateur connecté change SON propre PIN (via le serveur).
  function changeOwnPin(oldPin, newPin, newPin2) {
    if (!isLogged()) { return Promise.resolve({ ok: false, error: "Aucun opérateur connecté." }); }
    if (!isValidPin(newPin)) { return Promise.resolve({ ok: false, error: "Nouveau PIN invalide (4 à 6 chiffres)." }); }
    if (newPin !== newPin2) { return Promise.resolve({ ok: false, error: "Les deux PIN ne correspondent pas." }); }
    return CAEKServer.changePin(token(), oldPin, newPin).then(function (r) {
      if (r && r.ok === true) { return { ok: true }; }
      return { ok: false, error: (r && r.error === "pin") ? "Ancien PIN incorrect." : "Échec du changement de PIN." };
    }).catch(function (e) {
      return { ok: false, error: "Réseau requis pour changer le PIN. (" + (e && e.message || "") + ")" };
    });
  }

  /* ---------- Rendu : connexion / profil ---------- */
  function loginMsg(html, isError) {
    var box = $("login-msg"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }

  function renderLogin() {
    var box = $("login-msg");
    if (box) { box.hidden = true; }
  }

  function renderProfil() {
    var box = $("profil-active");
    if (!box) { return; }
    var s = session();
    box.innerHTML = s
      ? "<div class=\"profil-active-card\"><span class=\"profil-active-nom\">" + escapeHtml(s.nom) + "</span>" +
        "<span class=\"oper-role role-" + (s.is_admin ? "admin" : "operateur") + "\">" +
          (s.is_admin ? "Administrateur" : "Opérateur") + "</span>" +
        (s.fonction ? "<span class=\"profil-active-qualif\">" + escapeHtml(s.fonction) + "</span>" : "") +
        "<span class=\"profil-active-qualif\">&#127970; " +
          (s.labo_nom ? escapeHtml(s.labo_nom) : (s.is_admin ? "Tous les laboratoires" : "Aucun labo affecté")) + "</span>" +
        "<span class=\"profil-active-user\">@" + escapeHtml(s.identifiant) + "</span></div>"
      : "<p class=\"hint\">Aucun opérateur connecté.</p>";
  }

  /* ---------- Rendu : administration (opérateurs + labos) ---------- */
  function operResult(html, isError) {
    var box = $("oper-result"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }
  function laboResult(html, isError) {
    var box = $("labo-result"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }

  function laboOptions(selectedId, withNone) {
    var out = withNone
      ? "<option value=\"\">— Aucun (administrateur, voit tout) —</option>" : "";
    _labos.forEach(function (b) {
      if (b.actif === false && b.id !== selectedId) { return; }
      out += "<option value=\"" + escapeHtml(b.id) + "\"" + (b.id === selectedId ? " selected" : "") + ">" +
        escapeHtml(b.nom) + (b.actif === false ? " (désactivé)" : "") + "</option>";
    });
    return out;
  }

  function roleOptions(sel) {
    return ["operateur", "admin"].map(function (r) {
      return "<option value=\"" + r + "\"" + (r === sel ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>";
    }).join("");
  }

  function operItemHtml(o) {
    var isCurrent = (o.identifiant === activeUsername());
    var inactif = (o.actif === false);
    if (o.id === _editing) {
      return "<div class=\"oper-item is-editing\" data-id=\"" + escapeHtml(o.id) + "\">" +
        "<label class=\"field-label\">Nom affiché</label>" +
        "<input class=\"field oper-edit-nom\" type=\"text\" value=\"" + escapeHtml(o.nom) + "\">" +
        "<label class=\"field-label\">Identifiant</label>" +
        "<input class=\"field oper-edit-username\" type=\"text\" value=\"" + escapeHtml(o.identifiant) + "\">" +
        "<label class=\"field-label\">Qualification</label>" +
        "<input class=\"field oper-edit-qualif\" type=\"text\" value=\"" + escapeHtml(o.fonction || "") + "\">" +
        "<label class=\"field-label\">Rôle</label>" +
        "<select class=\"field oper-edit-role\">" + roleOptions(o.is_admin ? "admin" : "operateur") + "</select>" +
        "<label class=\"field-label\">Laboratoire d'affectation</label>" +
        "<select class=\"field oper-edit-labo\">" + laboOptions(o.labo_id || "", true) + "</select>" +
        "<label class=\"field-label\">Laboratoires vérifiés (administrateur — aucun coché = tous)</label>" +
        "<div class=\"oper-labo-checks\">" + laboCheckboxes(o.admin_labos || [], "oper-edit-adminlabo") + "</div>" +
        "<div class=\"oper-actions\">" +
          "<button type=\"button\" class=\"btn-primary\" data-act=\"enregistrer\" data-id=\"" + escapeHtml(o.id) + "\">&#128190; Enregistrer</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"reset-pin\" data-id=\"" + escapeHtml(o.id) + "\">Réinitialiser le PIN</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"annuler\" data-id=\"" + escapeHtml(o.id) + "\">Annuler</button>" +
        "</div></div>";
    }
    var badges = "<span class=\"oper-role role-" + (o.is_admin ? "admin" : "operateur") + "\">" +
        (o.is_admin ? "Administrateur" : "Opérateur") + "</span>" +
      "<span class=\"oper-badge\">&#127970; " + escapeHtml(o.labo_nom || (o.is_admin ? "Tous" : "—")) + "</span>" +
      (isCurrent ? "<span class=\"oper-badge is-active\">Connecté</span>" : "") +
      (inactif ? "<span class=\"oper-badge is-off\">Désactivé</span>" : "");
    var actions =
      "<button type=\"button\" class=\"btn-text\" data-act=\"modifier\" data-id=\"" + escapeHtml(o.id) + "\">Modifier</button>" +
      (inactif
        ? "<button type=\"button\" class=\"btn-text\" data-act=\"reactiver\" data-id=\"" + escapeHtml(o.id) + "\">Réactiver</button>"
        : "<button type=\"button\" class=\"btn-text oper-off\" data-act=\"desactiver\" data-id=\"" + escapeHtml(o.id) + "\">Désactiver</button>");
    return "<div class=\"oper-item" + (inactif ? " is-inactive" : "") + (isCurrent ? " is-current" : "") + "\" data-id=\"" + escapeHtml(o.id) + "\">" +
      "<div class=\"oper-info\"><span class=\"oper-nom\">" + escapeHtml(o.nom) + "</span> " + badges +
        (o.fonction ? "<span class=\"oper-qualif\">" + escapeHtml(o.fonction) + "</span>" : "") +
        "<span class=\"oper-username\">@" + escapeHtml(o.identifiant) + "</span></div>" +
      "<div class=\"oper-actions\">" + actions + "</div></div>";
  }

  function laboItemHtml(b) {
    var inactif = (b.actif === false);
    if (b.id === _editingLabo) {
      return "<div class=\"oper-item is-editing\" data-labo=\"" + escapeHtml(b.id) + "\">" +
        "<label class=\"field-label\">Nom</label>" +
        "<input class=\"field labo-edit-nom\" type=\"text\" value=\"" + escapeHtml(b.nom) + "\">" +
        "<label class=\"field-label\">Localisation</label>" +
        "<input class=\"field labo-edit-loc\" type=\"text\" value=\"" + escapeHtml(b.localisation || "") + "\">" +
        "<label class=\"field-label\">Seuil d'alerte déchets (éprouvettes)</label>" +
        "<input class=\"field labo-edit-seuil\" type=\"number\" min=\"10\" step=\"10\" value=\"" + (parseInt(b.seuilDechets, 10) || 100) + "\">" +
        "<div class=\"oper-actions\">" +
          "<button type=\"button\" class=\"btn-primary\" data-act=\"labo-enregistrer\" data-labo=\"" + escapeHtml(b.id) + "\">&#128190; Enregistrer</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"labo-annuler\" data-labo=\"" + escapeHtml(b.id) + "\">Annuler</button>" +
        "</div></div>";
    }
    var nb = _ops.filter(function (o) { return o.labo_id === b.id && o.actif !== false; }).length;
    return "<div class=\"oper-item" + (inactif ? " is-inactive" : "") + "\" data-labo=\"" + escapeHtml(b.id) + "\">" +
      "<div class=\"oper-info\"><span class=\"oper-nom\">&#127970; " + escapeHtml(b.nom) + "</span>" +
        (inactif ? "<span class=\"oper-badge is-off\">Désactivé</span>" : "") +
        (b.localisation ? "<span class=\"oper-qualif\">" + escapeHtml(b.localisation) + "</span>" : "") +
        "<span class=\"oper-username\">" + nb + " opérateur(s) · seuil déchets " + (parseInt(b.seuilDechets, 10) || 100) + "</span></div>" +
      "<div class=\"oper-actions\">" +
        "<button type=\"button\" class=\"btn-text\" data-act=\"labo-modifier\" data-labo=\"" + escapeHtml(b.id) + "\">Modifier</button>" +
        (inactif
          ? "<button type=\"button\" class=\"btn-text\" data-act=\"labo-reactiver\" data-labo=\"" + escapeHtml(b.id) + "\">Réactiver</button>"
          : "<button type=\"button\" class=\"btn-text oper-off\" data-act=\"labo-desactiver\" data-labo=\"" + escapeHtml(b.id) + "\">Désactiver</button>") +
      "</div></div>";
  }

  function renderAdminLists() {
    var opBox = $("oper-liste"), lbBox = $("labo-liste");
    if (opBox) {
      opBox.innerHTML = _ops.length ? _ops.map(operItemHtml).join("")
        : "<p class=\"hint\">Aucun opérateur.</p>";
    }
    if (lbBox) {
      lbBox.innerHTML = _labos.length ? _labos.map(laboItemHtml).join("")
        : "<p class=\"hint\">Aucun laboratoire.</p>";
    }
    var addLabo = $("oper-add-labo");
    if (addLabo) {
      var cur = addLabo.value;
      addLabo.innerHTML = laboOptions(cur, true);
    }
    // Cases « laboratoires vérifiés » du formulaire d'ajout (pour créer un
    // admin de validation scopé directement, sans repasser par l'édition).
    var addChecks = $("oper-add-adminlabo-checks");
    if (addChecks) { addChecks.innerHTML = laboCheckboxes([], "oper-add-adminlabo"); }
    toggleAddAdminLabo();
  }

  // Affiche les cases « laboratoires vérifiés » seulement pour le rôle Admin.
  function toggleAddAdminLabo() {
    var wrap = $("oper-add-adminlabo-wrap");
    if (wrap) { wrap.hidden = (val("oper-add-role") !== "admin"); }
  }

  // Charge opérateurs + labos depuis le serveur (écran Administration).
  function refreshAdmin() {
    var note = $("oper-admin-note");
    // Écran réservé à l'admin PRINCIPAL : la note s'affiche pour un opérateur
    // ET pour un admin de validation scopé (le serveur refuse admin_list_*).
    if (note) { note.hidden = isPrincipal(); }
    if (!isPrincipal() || !window.CAEKServer || !CAEKServer.configured()) { return Promise.resolve(); }
    return Promise.all([
      CAEKServer.adminListOperators(token()),
      CAEKServer.adminListLabos(token())
    ]).then(function (out) {
      _ops = (out[0] && out[0].ok && out[0].operators) || [];
      _labos = (out[1] && out[1].ok && out[1].labos) || [];
      renderAdminLists();
    }).catch(function (e) {
      operResult("&#9888; Chargement impossible (réseau requis) : " + escapeHtml(e && e.message || ""), true);
    });
  }

  function isOnOperScreen() {
    var s = $("screen-operateurs");
    return !!(s && s.classList.contains("is-active"));
  }

  function renderAll() {
    renderLogin();
    renderProfil();
    applyAdminVisibility();
    if (isOnOperScreen()) { refreshAdmin(); }
  }

  /* ---------- Aiguillage ---------- */
  function isOnLogin() { var s = $("screen-login"); return !!(s && s.classList.contains("is-active")); }
  function gate() {
    if (!isLogged()) {
      if (window.CAEKApp) { CAEKApp.navigate("screen-login", false); }
      try { history.replaceState({ screen: "screen-login" }, "", "#screen-login"); } catch (e) {}
    } else if (isOnLogin()) {
      if (window.CAEKApp) { CAEKApp.navigate("screen-accueil", false); }
      try { history.replaceState({ screen: "screen-accueil" }, "", "#screen-accueil"); } catch (e) {}
    }
  }

  /* ---------- Événements ---------- */
  function onLoginGo() {
    var btn = $("login-go");
    if (btn) { btn.disabled = true; btn.textContent = "Connexion…"; }
    login(val("login-user"), val("login-pin")).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = "🔒 Se connecter"; }
      if (!r.ok) { loginMsg("&#9888; " + escapeHtml(r.error), true); return; }
      clearVal("login-pin");
      loginMsg("&#10004; Connecté.", false);
      if (window.CAEKApp) { CAEKApp.navigate("screen-accueil"); }
    });
  }

  function promptPin(msg) {
    var p = window.prompt(msg + " (4 à 6 chiffres) :");
    return (p == null) ? null : String(p).trim();
  }

  function findOp(id) {
    for (var i = 0; i < _ops.length; i++) { if (_ops[i].id === id) { return _ops[i]; } }
    return null;
  }
  function findLabo(id) {
    for (var i = 0; i < _labos.length; i++) { if (_labos[i].id === id) { return _labos[i]; } }
    return null;
  }

  function saveOperator(payload, done) {
    CAEKServer.adminUpsertOperator(token(), payload).then(function (r) {
      if (!r || r.ok !== true) {
        var msgs = {
          identifiant_existe: "Cet identifiant existe déjà.",
          pin_requis: "Le PIN est obligatoire à la création.",
          labo_requis: "Choisissez un laboratoire d'affectation (obligatoire pour un opérateur).",
          admin: "Action réservée à l'administrateur."
        };
        operResult("&#9888; " + (msgs[r && r.error] || "Échec de l'enregistrement."), true);
        return;
      }
      done();
    }).catch(function (e) {
      operResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true);
    });
  }

  function onAdd() {
    if (!requireAdmin("ajouter un opérateur")) { return; }
    var isAdm = val("oper-add-role") === "admin";
    var laboSel = val("oper-add-labo");
    if (!val("oper-add-nom").trim()) { operResult("&#9888; Le nom affiché est obligatoire.", true); return; }
    if (!val("oper-add-username").trim()) { operResult("&#9888; L'identifiant est obligatoire.", true); return; }
    if (!isValidPin(val("oper-add-pin"))) { operResult("&#9888; PIN invalide (4 à 6 chiffres).", true); return; }
    if (!isAdm && !laboSel) { operResult("&#9888; Choisissez le laboratoire d'affectation.", true); return; }
    saveOperator({
      id: null,
      identifiant: val("oper-add-username").trim().toLowerCase(),
      pin: val("oper-add-pin"),
      nom: val("oper-add-nom").trim(),
      fonction: val("oper-add-qualif").trim(),
      is_admin: isAdm,
      actif: true,
      labo_id: laboSel || null,
      // Admin scopé (validation) si des labos sont cochés ; sinon principal.
      admin_labos: isAdm ? readChecked(document, "oper-add-adminlabo") : null
    }, function () {
      clearVal("oper-add-nom", "oper-add-username", "oper-add-qualif", "oper-add-pin");
      operResult("&#10004; Opérateur ajouté.", false);
      refreshAdmin();
    });
  }

  function onListClick(ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!btn) { return; }
    var act = btn.getAttribute("data-act");
    var id = btn.getAttribute("data-id");
    var laboId2 = btn.getAttribute("data-labo");

    /* --- Opérateurs --- */
    if (act === "modifier") { _editing = id; renderAdminLists(); }
    else if (act === "annuler") { _editing = null; renderAdminLists(); }
    else if (act === "enregistrer") {
      var item = btn.closest(".oper-item");
      var o = findOp(id); if (!o) { return; }
      saveOperator({
        id: id,
        identifiant: item.querySelector(".oper-edit-username").value.trim().toLowerCase(),
        pin: "",
        nom: item.querySelector(".oper-edit-nom").value.trim(),
        fonction: item.querySelector(".oper-edit-qualif").value.trim(),
        is_admin: item.querySelector(".oper-edit-role").value === "admin",
        actif: o.actif !== false,
        labo_id: item.querySelector(".oper-edit-labo").value || null,
        admin_labos: readChecked(item, "oper-edit-adminlabo")
      }, function () {
        _editing = null;
        operResult("&#10004; Opérateur mis à jour.", false);
        refreshAdmin().then(verifyOnline);
      });
    } else if (act === "reset-pin") {
      if (!requireAdmin("réinitialiser un PIN")) { return; }
      var o2 = findOp(id); if (!o2) { return; }
      var p1 = promptPin("Nouveau PIN pour @" + o2.identifiant);
      if (p1 == null) { return; }
      if (!isValidPin(p1)) { operResult("&#9888; PIN invalide (4 à 6 chiffres).", true); return; }
      var p2 = promptPin("Confirmer le PIN");
      if (p2 == null) { return; }
      if (p1 !== p2) { operResult("&#9888; Les deux PIN ne correspondent pas.", true); return; }
      saveOperator({
        id: id, identifiant: o2.identifiant, pin: p1, nom: o2.nom,
        fonction: o2.fonction || "", is_admin: o2.is_admin === true,
        actif: o2.actif !== false, labo_id: o2.labo_id || null,
        admin_labos: o2.admin_labos || null   // préserver les droits labo
      }, function () {
        _editing = null;
        operResult("&#10004; PIN réinitialisé.", false);
        refreshAdmin();
      });
    } else if (act === "desactiver" || act === "reactiver") {
      var on = (act === "reactiver");
      if (!on && !window.confirm("Désactiver cet opérateur ? Il ne pourra plus se connecter.")) { return; }
      CAEKServer.adminSetOperatorActive(token(), id, on).then(function (r) {
        if (!r || r.ok !== true) { operResult("&#9888; Échec.", true); return; }
        operResult(on ? "Opérateur réactivé." : "Opérateur désactivé.", false);
        refreshAdmin();
      }).catch(function (e) { operResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
    }

    /* --- Laboratoires --- */
    else if (act === "labo-modifier") { _editingLabo = laboId2; renderAdminLists(); }
    else if (act === "labo-annuler") { _editingLabo = null; renderAdminLists(); }
    else if (act === "labo-enregistrer") {
      var item2 = btn.closest(".oper-item");
      var b = findLabo(laboId2); if (!b) { return; }
      CAEKServer.adminUpsertLabo(token(), {
        id: laboId2,
        nom: item2.querySelector(".labo-edit-nom").value.trim(),
        localisation: item2.querySelector(".labo-edit-loc").value.trim(),
        seuilDechets: parseInt(item2.querySelector(".labo-edit-seuil").value, 10) || 100,
        actif: b.actif !== false
      }).then(function (r) {
        if (!r || r.ok !== true) {
          laboResult("&#9888; " + (r && r.error === "nom_existe" ? "Ce nom de laboratoire existe déjà." : "Échec."), true);
          return;
        }
        _editingLabo = null;
        laboResult("&#10004; Laboratoire mis à jour.", false);
        refreshAdmin().then(verifyOnline);
      }).catch(function (e) { laboResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
    } else if (act === "labo-desactiver" || act === "labo-reactiver") {
      var on2 = (act === "labo-reactiver");
      var b2 = findLabo(laboId2); if (!b2) { return; }
      if (!on2 && !window.confirm("Désactiver ce laboratoire ? Il n'apparaîtra plus dans les listes.")) { return; }
      CAEKServer.adminUpsertLabo(token(), {
        id: laboId2, nom: b2.nom, localisation: b2.localisation || "",
        seuilDechets: parseInt(b2.seuilDechets, 10) || 100, actif: on2
      }).then(function (r) {
        if (!r || r.ok !== true) { laboResult("&#9888; Échec.", true); return; }
        laboResult(on2 ? "Laboratoire réactivé." : "Laboratoire désactivé.", false);
        refreshAdmin();
      }).catch(function (e) { laboResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
    }
  }

  function onLaboAdd() {
    if (!requireAdmin("ajouter un laboratoire")) { return; }
    var nom = val("labo-add-nom").trim();
    if (!nom) { laboResult("&#9888; Le nom du laboratoire est obligatoire.", true); return; }
    CAEKServer.adminUpsertLabo(token(), {
      id: null, nom: nom,
      localisation: val("labo-add-loc").trim(),
      seuilDechets: parseInt(val("labo-add-seuil"), 10) || 100,
      actif: true
    }).then(function (r) {
      if (!r || r.ok !== true) {
        laboResult("&#9888; " + (r && r.error === "nom_existe" ? "Ce nom de laboratoire existe déjà." : "Échec."), true);
        return;
      }
      clearVal("labo-add-nom", "labo-add-loc");
      laboResult("&#10004; Laboratoire ajouté : <strong>" + escapeHtml(nom) + "</strong>.", false);
      refreshAdmin();
    }).catch(function (e) { laboResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  function onChangeOwnPin() {
    var old = promptPin("Votre PIN actuel");
    if (old == null) { return; }
    var n1 = promptPin("Nouveau PIN");
    if (n1 == null) { return; }
    var n2 = promptPin("Confirmer le nouveau PIN");
    if (n2 == null) { return; }
    changeOwnPin(old, n1, n2).then(function (r) {
      if (window.alert) { window.alert(r.ok ? "PIN modifié." : (r.error || "Échec.")); }
    });
  }

  function wire() {
    var lg = $("login-go"); if (lg) { lg.addEventListener("click", onLoginGo); }
    var lp = $("login-pin");
    if (lp) { lp.addEventListener("keydown", function (e) { if (e.key === "Enter") { onLoginGo(); } }); }
    var addBtn = $("oper-add-btn"); if (addBtn) { addBtn.addEventListener("click", onAdd); }
    var addRole = $("oper-add-role"); if (addRole) { addRole.addEventListener("change", toggleAddAdminLabo); }
    var lst = $("oper-liste"); if (lst) { lst.addEventListener("click", onListClick); }
    var lbl = $("labo-liste"); if (lbl) { lbl.addEventListener("click", onListClick); }
    var lba = $("labo-add-btn"); if (lba) { lba.addEventListener("click", onLaboAdd); }
    var back = $("oper-back");
    if (back) { back.addEventListener("click", function () { if (window.CAEKApp) { CAEKApp.navigate(isLogged() ? "screen-profil" : "screen-login"); } }); }
    var chg = $("profil-changer");
    if (chg) {
      chg.addEventListener("click", function () {
        if (!window.confirm("Se déconnecter et changer d'opérateur ?")) { return; }
        logout();
      });
    }
    var pin = $("profil-pin"); if (pin) { pin.addEventListener("click", onChangeOwnPin); }
    window.addEventListener("online", function () { verifyOnline(); });
  }

  /* ---------- Initialisation ---------- */
  function init() {
    session();                 // charge la session depuis localStorage
    wire();
    applyActive();             // profil + classes de rôle
    renderAll();
    gate();
    verifyOnline();            // revalidation en arrière-plan (si réseau)
  }

  return {
    init: init,
    isLogged: isLogged,
    getActive: getActive,
    activeUsername: activeUsername,
    role: role,
    isAdmin: isAdmin,
    canSupervise: canSupervise,
    requireAdmin: requireAdmin,
    applyRoleClass: applyRoleClass,
    login: login,
    logout: logout,
    renderAll: renderAll,
    token: token,
    session: session,
    laboId: laboId,
    laboNom: laboNom,
    adminLabos: adminLabos,
    isPrincipal: isPrincipal,
    verifyOnline: verifyOnline,
    ROLE_LABEL: ROLE_LABEL
  };
})();
