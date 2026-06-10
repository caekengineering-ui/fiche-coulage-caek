/* ============================================================
   Fiche de coulage terrain - CAEK
   operateurs.js - Connexion sécurisée + gestion des opérateurs.

   Phase 1 (sécurité d'accès) :
   - Opérateur = { username, nom, qualification, role, pinHash, actif }
   - role : "admin" | "chef" | "operateur"
   - Connexion par opérateur + code PIN (4-6 chiffres). Le PIN n'est
     JAMAIS stocké en clair : seul son empreinte SHA-256 (salée par
     username) est conservée.
   - L'opérateur actif alimente le profil global (CAEKProfil) qui signe
     toutes les actions importantes.
   - Permissions : actions sensibles réservées à l'administrateur
     (gestion des opérateurs, paramètres déchets, migration cloud,
     configuration Firebase, suppressions).
   - Stockage LOCAL (localStorage + IndexedDB "meta"). PWA hors-ligne
     intacte. Migration Firestore prévue (Phase ultérieure).

   Phase 2 (à venir) : corbeille (soft-delete) + journal complet.
   ============================================================ */
var CAEKOperateurs = (function () {
  "use strict";

  var LS_LIST = "caek_operateurs";
  var LS_ACTIF = "caek_operateur_actif";
  var META_LIST = "operateurs";
  var META_ACTIF = "operateurActif";

  var ROLE_RANK = { operateur: 1, chef: 2, admin: 3 };
  var ROLE_LABEL = { operateur: "Opérateur", chef: "Chef labo", admin: "Administrateur" };

  var _list = null;        // tableau cache
  var _actif = undefined;  // username actif (string) ou null
  var _editing = null;     // username en cours d'edition (gestion)

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function slug(s) {
    var base = String(s || "").trim().toLowerCase();
    if (base.normalize) { base = base.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    return base || "op";
  }

  /* ---------- Empreinte du PIN (SHA-256 salé) ---------- */
  function isValidPin(pin) { return /^[0-9]{4,6}$/.test(String(pin || "")); }

  function fnv1aHex(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return "fnv:" + ("00000000" + h.toString(16)).slice(-8);
  }
  function hashPin(username, pin) {
    var msg = "caek-pin:" + username + ":" + pin;
    if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
      try {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg)).then(function (buf) {
          var b = new Uint8Array(buf), out = "";
          for (var i = 0; i < b.length; i++) { out += ("0" + b[i].toString(16)).slice(-2); }
          return out;
        }).catch(function () { return fnv1aHex(msg); });
      } catch (e) { return Promise.resolve(fnv1aHex(msg)); }
    }
    return Promise.resolve(fnv1aHex(msg));   // repli si WebCrypto indisponible
  }
  function verifyPin(op, pin) {
    if (!op || !op.pinHash) { return Promise.resolve(false); }
    return hashPin(op.username, pin).then(function (h) { return h === op.pinHash; });
  }

  /* ---------- Persistance ---------- */
  function readLS(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function writeLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function loadCache() {
    if (_list === null) { var l = readLS(LS_LIST); _list = Array.isArray(l) ? l : []; }
    if (_actif === undefined) { _actif = readLS(LS_ACTIF) || null; }
  }
  function persist() {
    writeLS(LS_LIST, _list);
    writeLS(LS_ACTIF, _actif);
    if (window.CAEKDB && CAEKDB.setMeta) {
      return Promise.all([CAEKDB.setMeta(META_LIST, _list), CAEKDB.setMeta(META_ACTIF, _actif)]);
    }
    return Promise.resolve();
  }

  /* ---------- Accesseurs ---------- */
  function list() { loadCache(); return _list.slice(); }
  function actifs() { loadCache(); return _list.filter(function (o) { return o.actif !== false; }); }
  function find(username) {
    loadCache();
    for (var i = 0; i < _list.length; i++) { if (_list[i].username === username) { return _list[i]; } }
    return null;
  }
  function activeUsername() { loadCache(); return _actif; }
  function getActive() { var u = activeUsername(); return u ? find(u) : null; }
  function isLogged() { return !!getActive(); }
  function role() { var a = getActive(); return a ? (a.role || "operateur") : null; }
  function roleRank() { return ROLE_RANK[role()] || 0; }
  function isAdmin() { return role() === "admin"; }
  function canSupervise() { return roleRank() >= ROLE_RANK.chef; }   // chef ou admin

  // Garde-fou : action reservee a l'administrateur.
  function requireAdmin(label) {
    if (isAdmin()) { return true; }
    if (window.alert) { window.alert("Action réservée à l'administrateur" + (label ? " : " + label : "") + "."); }
    return false;
  }

  /* ---------- Activation / connexion ---------- */
  function applyActive(op) {
    _actif = op ? op.username : null;
    if (window.CAEKProfil) {
      if (op) { CAEKProfil.save(op.nom, op.qualification, op.username); }
      else { CAEKProfil.clear(); }
    }
    applyRoleClass();
  }
  function applyRoleClass() {
    if (!document.body) { return; }
    var cl = document.body.classList;
    cl.remove("is-admin", "is-chef", "is-operateur");
    var r = role();
    if (r === "admin") { cl.add("is-admin"); }
    else if (r === "chef") { cl.add("is-chef"); }
    else if (r === "operateur") { cl.add("is-operateur"); }
    applyAdminVisibility();
  }
  // Masque les elements marques admin-only pour les non-admins (defense + UX).
  function applyAdminVisibility() {
    var admin = isAdmin();
    var els = document.querySelectorAll(".admin-only");
    for (var i = 0; i < els.length; i++) { els[i].hidden = !admin; }
  }

  // Connexion : verifie le PIN puis active l'operateur.
  function login(username, pin) {
    var op = find(username);
    if (!op || op.actif === false) { return Promise.resolve({ ok: false, error: "Opérateur introuvable ou désactivé." }); }
    if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
    return verifyPin(op, pin).then(function (ok) {
      if (!ok) { return { ok: false, error: "Code PIN incorrect." }; }
      applyActive(op);
      return persist().then(function () {
        renderAll();
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
        return { ok: true, op: op };
      });
    });
  }

  // Premier acces d'un operateur sans PIN : il definit son PIN puis se connecte.
  function setupPinAndLogin(username, pin, pin2) {
    var op = find(username);
    if (!op) { return Promise.resolve({ ok: false, error: "Opérateur introuvable." }); }
    if (op.pinHash) { return Promise.resolve({ ok: false, error: "Un PIN existe déjà." }); }
    if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
    if (pin !== pin2) { return Promise.resolve({ ok: false, error: "Les deux PIN ne correspondent pas." }); }
    return hashPin(username, pin).then(function (h) {
      op.pinHash = h;
      applyActive(op);
      return persist().then(function () {
        renderAll();
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
        return { ok: true, op: op };
      });
    });
  }

  function logout() {
    applyActive(null);
    persist();
    renderAll();
    if (window.CAEKApp) { CAEKApp.navigate("screen-login"); }
  }

  /* ---------- Gestion (administrateur) ---------- */
  // Cree le PREMIER administrateur (aucun operateur encore). Pas de garde-fou
  // de role car personne n'est connecte (amorçage).
  function createFirstAdmin(nom, qualif, pin, pin2) {
    loadCache();
    if (_list.length) { return Promise.resolve({ ok: false, error: "Des opérateurs existent déjà." }); }
    nom = (nom || "").trim();
    if (!nom) { return Promise.resolve({ ok: false, error: "Le nom est obligatoire." }); }
    if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
    if (pin !== pin2) { return Promise.resolve({ ok: false, error: "Les deux PIN ne correspondent pas." }); }
    var username = slug(nom);
    return hashPin(username, pin).then(function (h) {
      var op = { username: username, nom: nom, qualification: (qualif || "").trim(), role: "admin", pinHash: h, actif: true };
      _list.push(op);
      applyActive(op);
      return persist().then(function () { return { ok: true, op: op }; });
    });
  }

  // Ajout d'un operateur (admin). PIN facultatif a la creation : sinon
  // l'operateur le definira a son premier acces.
  function add(op) {
    if (!requireAdmin("ajouter un opérateur")) { return Promise.resolve({ ok: false, error: "Réservé à l'administrateur." }); }
    loadCache();
    var nom = (op && op.nom || "").trim();
    if (!nom) { return Promise.resolve({ ok: false, error: "Le nom affiché est obligatoire." }); }
    var qualification = (op && op.qualification || "").trim();
    var roleVal = (op && op.role) || "operateur";
    if (!ROLE_RANK[roleVal]) { roleVal = "operateur"; }
    var username = slug((op && op.username) || nom);
    var base = username, n = 2;
    while (find(username)) { username = base + "-" + n; n++; }
    var pin = (op && op.pin) || "";
    var finalize = function (pinHash) {
      _list.push({ username: username, nom: nom, qualification: qualification, role: roleVal, pinHash: pinHash, actif: true });
      return persist().then(function () { return { ok: true, username: username }; });
    };
    if (pin) {
      if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
      return hashPin(username, pin).then(finalize);
    }
    return finalize(null);
  }

  function update(username, fields) {
    if (!requireAdmin("modifier un opérateur")) { return { ok: false }; }
    var op = find(username);
    if (!op) { return { ok: false }; }
    if (fields.nom !== undefined) { op.nom = String(fields.nom).trim() || op.nom; }
    if (fields.qualification !== undefined) { op.qualification = String(fields.qualification).trim(); }
    if (fields.role !== undefined && ROLE_RANK[fields.role]) { op.role = fields.role; }
    if (fields.actif !== undefined) { op.actif = !!fields.actif; }
    persist();
    if (_actif === username && op.actif !== false) { applyActive(op); }  // resync profil/role
    return { ok: true };
  }

  // Reinitialisation du PIN d'un operateur par l'admin.
  function resetPin(username, pin, pin2) {
    if (!requireAdmin("réinitialiser un PIN")) { return Promise.resolve({ ok: false }); }
    var op = find(username);
    if (!op) { return Promise.resolve({ ok: false, error: "Opérateur introuvable." }); }
    if (pin === "" || pin == null) {   // PIN vide => efface (l'operateur le redefinira)
      op.pinHash = null;
      return persist().then(function () { return { ok: true, cleared: true }; });
    }
    if (!isValidPin(pin)) { return Promise.resolve({ ok: false, error: "PIN invalide (4 à 6 chiffres)." }); }
    if (pin !== pin2) { return Promise.resolve({ ok: false, error: "Les deux PIN ne correspondent pas." }); }
    return hashPin(username, pin).then(function (h) {
      op.pinHash = h;
      return persist().then(function () { return { ok: true }; });
    });
  }

  function setActif(username, bool) {
    if (!requireAdmin("désactiver un opérateur")) { return { ok: false }; }
    var r = update(username, { actif: !!bool });
    if (!bool && _actif === username) { logout(); }
    else { renderAll(); }
    return r;
  }

  // L'utilisateur connecte change SON propre PIN (ancien -> nouveau).
  function changeOwnPin(oldPin, newPin, newPin2) {
    var op = getActive();
    if (!op) { return Promise.resolve({ ok: false, error: "Aucun opérateur connecté." }); }
    if (!isValidPin(newPin)) { return Promise.resolve({ ok: false, error: "Nouveau PIN invalide (4 à 6 chiffres)." }); }
    if (newPin !== newPin2) { return Promise.resolve({ ok: false, error: "Les deux PIN ne correspondent pas." }); }
    var checkOld = op.pinHash ? verifyPin(op, oldPin) : Promise.resolve(true);
    return checkOld.then(function (ok) {
      if (!ok) { return { ok: false, error: "Ancien PIN incorrect." }; }
      return hashPin(op.username, newPin).then(function (h) {
        op.pinHash = h;
        return persist().then(function () { return { ok: true }; });
      });
    });
  }

  // Migration douce : un profil existant devient le 1er administrateur
  // (sans PIN -> il le definira a son 1er acces).
  function migrateFromProfilObj(p) {
    loadCache();
    if (_list.length || !p || !p.nom) { return; }
    var username = slug(p.nom);
    _list.push({ username: username, nom: p.nom, qualification: p.qualification || "", role: "admin", pinHash: null, actif: true });
    _actif = null;   // pas de connexion automatique : il devra definir son PIN
    persist();
  }

  // Mise a niveau des donnees V2.05 (sans role/PIN) vers V2.06 :
  //  - role par defaut "operateur" ; garantir au moins un administrateur ;
  //  - si l'operateur actif n'a pas de PIN, le forcer a se reconnecter pour
  //    le definir (pas de session non protegee).
  function normalizeUpgrade() {
    loadCache();
    if (!_list.length) { return; }
    var changed = false;
    _list.forEach(function (o) { if (!o.role || !ROLE_RANK[o.role]) { o.role = "operateur"; changed = true; } });
    var hasAdmin = _list.some(function (o) { return o.role === "admin" && o.actif !== false; });
    if (!hasAdmin) {
      var target = (_actif && find(_actif)) ||
        _list.filter(function (o) { return o.actif !== false; })[0] || _list[0];
      if (target) { target.role = "admin"; changed = true; }
    }
    var a = _actif ? find(_actif) : null;
    if (a && !a.pinHash) { _actif = null; changed = true; }   // session sans PIN -> reconnexion
    if (changed) { persist(); }
  }

  /* ---------- Rendu ---------- */
  function opLine(o) { return escapeHtml(o.nom) + (o.qualification ? " — " + escapeHtml(o.qualification) : ""); }
  function roleLabel(r) { return ROLE_LABEL[r] || "Opérateur"; }

  function needsPinSetup(username) {
    var op = find(username);
    return !!(op && !op.pinHash);
  }

  function renderLogin() {
    var setup = $("login-setup"), form = $("login-form");
    if (!setup || !form) { return; }
    var ops = actifs();
    if (ops.length === 0) {
      setup.hidden = false; form.hidden = true;
      return;
    }
    setup.hidden = true; form.hidden = false;
    var sel = $("login-select");
    var current = sel ? sel.value : "";
    sel.innerHTML = ops.map(function (o) {
      return "<option value=\"" + escapeHtml(o.username) + "\">" + opLine(o) +
        " · " + roleLabel(o.role) + "</option>";
    }).join("");
    if (current && find(current)) { sel.value = current; }
    updateLoginPinState();
  }

  function updateLoginPinState() {
    var sel = $("login-select");
    if (!sel) { return; }
    var setupNeeded = needsPinSetup(sel.value);
    var hint = $("login-setpin-hint");
    var lbl2 = $("login-pin2-label"), pin2 = $("login-pin2");
    var go = $("login-go"), pinLbl = $("login-pin-label");
    if (hint) { hint.hidden = !setupNeeded; }
    if (lbl2) { lbl2.hidden = !setupNeeded; }
    if (pin2) { pin2.hidden = !setupNeeded; }
    if (pinLbl) { pinLbl.textContent = setupNeeded ? "Définir un code PIN (4 à 6 chiffres)" : "Code PIN"; }
    if (go) { go.textContent = setupNeeded ? "Définir mon PIN et me connecter" : "Se connecter"; }
  }

  function operItemHtml(o) {
    var isActive = (o.username === _actif);
    var inactif = (o.actif === false);
    var admin = isAdmin();
    if (admin && o.username === _editing) {
      return "<div class=\"oper-item is-editing\" data-username=\"" + escapeHtml(o.username) + "\">" +
        "<label class=\"field-label\">Nom affiché</label>" +
        "<input class=\"field oper-edit-nom\" type=\"text\" value=\"" + escapeHtml(o.nom) + "\">" +
        "<label class=\"field-label\">Qualification</label>" +
        "<input class=\"field oper-edit-qualif\" type=\"text\" value=\"" + escapeHtml(o.qualification || "") + "\">" +
        "<label class=\"field-label\">Rôle</label>" +
        "<select class=\"field oper-edit-role\">" + roleOptions(o.role) + "</select>" +
        "<div class=\"oper-actions\">" +
          "<button type=\"button\" class=\"btn-primary\" data-act=\"enregistrer\" data-username=\"" + escapeHtml(o.username) + "\">&#128190; Enregistrer</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"reset-pin\" data-username=\"" + escapeHtml(o.username) + "\">Réinitialiser le PIN</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"annuler\" data-username=\"" + escapeHtml(o.username) + "\">Annuler</button>" +
        "</div></div>";
    }
    var badges = "<span class=\"oper-role role-" + (o.role || "operateur") + "\">" + roleLabel(o.role) + "</span>" +
      (isActive ? "<span class=\"oper-badge is-active\">Connecté</span>" : "") +
      (inactif ? "<span class=\"oper-badge is-off\">Désactivé</span>" : "") +
      (!o.pinHash ? "<span class=\"oper-badge is-nopin\">PIN à définir</span>" : "");
    var actions = "";
    if (admin) {
      actions += "<button type=\"button\" class=\"btn-text\" data-act=\"modifier\" data-username=\"" + escapeHtml(o.username) + "\">Modifier</button>";
      if (inactif) {
        actions += "<button type=\"button\" class=\"btn-text\" data-act=\"reactiver\" data-username=\"" + escapeHtml(o.username) + "\">Réactiver</button>";
      } else {
        actions += "<button type=\"button\" class=\"btn-text oper-off\" data-act=\"desactiver\" data-username=\"" + escapeHtml(o.username) + "\">Désactiver</button>";
      }
    }
    return "<div class=\"oper-item" + (inactif ? " is-inactive" : "") + (isActive ? " is-current" : "") + "\" data-username=\"" + escapeHtml(o.username) + "\">" +
      "<div class=\"oper-info\"><span class=\"oper-nom\">" + escapeHtml(o.nom) + "</span> " + badges +
        (o.qualification ? "<span class=\"oper-qualif\">" + escapeHtml(o.qualification) + "</span>" : "") +
        "<span class=\"oper-username\">@" + escapeHtml(o.username) + "</span></div>" +
      (actions ? "<div class=\"oper-actions\">" + actions + "</div>" : "") + "</div>";
  }

  function roleOptions(sel) {
    return ["operateur", "chef", "admin"].map(function (r) {
      return "<option value=\"" + r + "\"" + (r === sel ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>";
    }).join("");
  }

  function renderOperateurs() {
    var box = $("oper-liste");
    if (!box) { return; }
    var ops = list();
    if (!ops.length) {
      box.innerHTML = "<p class=\"hint\">Aucun opérateur.</p>";
    } else {
      box.innerHTML = ops.map(operItemHtml).join("");
    }
    // Note d'acces pour les non-admins.
    var note = $("oper-admin-note");
    if (note) { note.hidden = isAdmin(); }
    // Pre-remplir le select de role d'ajout si present.
    var addRole = $("oper-add-role");
    if (addRole && !addRole.innerHTML) { addRole.innerHTML = roleOptions("operateur"); }
  }

  function renderProfil() {
    var box = $("profil-active");
    if (!box) { return; }
    var a = getActive();
    box.innerHTML = a
      ? "<div class=\"profil-active-card\"><span class=\"profil-active-nom\">" + escapeHtml(a.nom) + "</span>" +
        "<span class=\"oper-role role-" + (a.role || "operateur") + "\">" + roleLabel(a.role) + "</span>" +
        (a.qualification ? "<span class=\"profil-active-qualif\">" + escapeHtml(a.qualification) + "</span>" : "") +
        "<span class=\"profil-active-user\">@" + escapeHtml(a.username) + "</span></div>"
      : "<p class=\"hint\">Aucun opérateur connecté.</p>";
  }

  function renderAll() { renderLogin(); renderOperateurs(); renderProfil(); applyAdminVisibility(); }

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

  /* ---------- Evenements ---------- */
  function loginMsg(html, isError) {
    var box = $("login-msg"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }
  function setupMsg(html, isError) {
    var box = $("setup-msg"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }
  function operResult(html, isError) {
    var box = $("oper-result"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }
  function val(id) { var e = $(id); return e ? e.value : ""; }
  function clearVal() { for (var i = 0; i < arguments.length; i++) { var e = $(arguments[i]); if (e) { e.value = ""; } } }

  function onLoginGo() {
    var u = val("login-select");
    if (!u) { loginMsg("&#9888; Sélectionnez un opérateur.", true); return; }
    if (needsPinSetup(u)) {
      setupPinAndLogin(u, val("login-pin"), val("login-pin2")).then(function (r) {
        if (!r.ok) { loginMsg("&#9888; " + escapeHtml(r.error), true); return; }
        clearVal("login-pin", "login-pin2");
        if (window.CAEKApp) { CAEKApp.navigate("screen-accueil"); }
      });
    } else {
      login(u, val("login-pin")).then(function (r) {
        if (!r.ok) { loginMsg("&#9888; " + escapeHtml(r.error), true); return; }
        clearVal("login-pin");
        if (window.CAEKApp) { CAEKApp.navigate("screen-accueil"); }
      });
    }
  }

  function onSetupGo() {
    createFirstAdmin(val("setup-nom"), val("setup-qualif"), val("setup-pin"), val("setup-pin2")).then(function (r) {
      if (!r.ok) { setupMsg("&#9888; " + escapeHtml(r.error), true); return; }
      clearVal("setup-nom", "setup-qualif", "setup-pin", "setup-pin2");
      renderAll();
      if (window.CAEKApp) { CAEKApp.navigate("screen-accueil"); }
    });
  }

  function onAdd() {
    if (!requireAdmin("ajouter un opérateur")) { return; }
    add({ nom: val("oper-add-nom"), username: val("oper-add-username"),
      qualification: val("oper-add-qualif"), role: val("oper-add-role"), pin: val("oper-add-pin") }).then(function (r) {
      if (!r.ok) { operResult("&#9888; " + escapeHtml(r.error), true); return; }
      clearVal("oper-add-nom", "oper-add-username", "oper-add-qualif", "oper-add-pin");
      renderAll();
      operResult("&#10004; Opérateur ajouté : <strong>@" + escapeHtml(r.username) + "</strong>.", false);
    });
  }

  function promptPin(msg) {
    var p = window.prompt(msg + " (4 à 6 chiffres) :");
    return (p == null) ? null : String(p).trim();
  }

  function onListClick(ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!btn) { return; }
    var act = btn.getAttribute("data-act");
    var u = btn.getAttribute("data-username");
    if (act === "modifier") { _editing = u; renderOperateurs(); }
    else if (act === "annuler") { _editing = null; renderOperateurs(); }
    else if (act === "enregistrer") {
      var item = btn.closest(".oper-item");
      update(u, { nom: item.querySelector(".oper-edit-nom").value,
        qualification: item.querySelector(".oper-edit-qualif").value,
        role: item.querySelector(".oper-edit-role").value });
      _editing = null; renderAll();
      operResult("&#10004; Opérateur mis à jour.", false);
    } else if (act === "reset-pin") {
      if (!requireAdmin("réinitialiser un PIN")) { return; }
      var p1 = promptPin("Nouveau PIN (laisser vide pour que l'opérateur le définisse)");
      if (p1 == null) { return; }
      var p2 = p1 ? promptPin("Confirmer le PIN") : "";
      resetPin(u, p1, p2).then(function (r) {
        if (!r.ok) { operResult("&#9888; " + escapeHtml(r.error || "Échec."), true); return; }
        _editing = null; renderAll();
        operResult(r.cleared ? "PIN effacé : l'opérateur le définira à son prochain accès." : "&#10004; PIN réinitialisé.", false);
      });
    } else if (act === "desactiver") {
      if (!window.confirm("Désactiver cet opérateur ? Il ne pourra plus se connecter.")) { return; }
      setActif(u, false); operResult("Opérateur désactivé.", false);
    } else if (act === "reactiver") {
      setActif(u, true); operResult("Opérateur réactivé.", false);
    }
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
    var ls = $("login-select"); if (ls) { ls.addEventListener("change", updateLoginPinState); }
    var sg = $("setup-go"); if (sg) { sg.addEventListener("click", onSetupGo); }
    var addBtn = $("oper-add-btn"); if (addBtn) { addBtn.addEventListener("click", onAdd); }
    var lst = $("oper-liste"); if (lst) { lst.addEventListener("click", onListClick); }
    var back = $("oper-back");
    if (back) { back.addEventListener("click", function () { if (window.CAEKApp) { CAEKApp.navigate(isLogged() ? "screen-accueil" : "screen-login"); } }); }
    var chg = $("profil-changer"); if (chg) { chg.addEventListener("click", function () { if (window.CAEKApp) { CAEKApp.navigate("screen-login"); } }); }
    var pin = $("profil-pin"); if (pin) { pin.addEventListener("click", onChangeOwnPin); }
  }

  /* ---------- Initialisation ---------- */
  function afterLoad(durableProfil) {
    loadCache();
    if (_list.length === 0) {
      var p = (window.CAEKProfil && CAEKProfil.isRenseigne()) ? CAEKProfil.get()
            : (durableProfil && durableProfil.nom ? durableProfil : null);
      migrateFromProfilObj(p);
    }
    normalizeUpgrade();
    applyActive(getActive());   // resync profil + role + visibilite
    renderAll();
    gate();
  }

  function init() {
    loadCache();
    wire();
    applyRoleClass();
    renderAll();
    gate();
    if (window.CAEKDB && CAEKDB.getMeta) {
      Promise.all([
        CAEKDB.getMeta(META_LIST), CAEKDB.getMeta(META_ACTIF), CAEKDB.getMeta("profilOperateur")
      ]).then(function (o) {
        if (Array.isArray(o[0]) && o[0].length) { _list = o[0]; writeLS(LS_LIST, _list); }
        if (o[1] != null) { _actif = o[1]; writeLS(LS_ACTIF, _actif); }
        afterLoad(o[2]);
      }).catch(function () { afterLoad(null); });
    } else {
      afterLoad(null);
    }
  }

  return {
    init: init,
    list: list,
    actifs: actifs,
    activeUsername: activeUsername,
    getActive: getActive,
    isLogged: isLogged,
    role: role,
    isAdmin: isAdmin,
    canSupervise: canSupervise,
    requireAdmin: requireAdmin,
    applyRoleClass: applyRoleClass,
    login: login,
    logout: logout,
    add: add,
    update: update,
    resetPin: resetPin,
    setActif: setActif,
    renderAll: renderAll,
    ROLE_LABEL: ROLE_LABEL
  };
})();
