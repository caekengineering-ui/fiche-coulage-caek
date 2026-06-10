/* ============================================================
   Fiche de coulage terrain - CAEK
   operateurs.js - Gestion locale des operateurs + connexion.

   - Liste d'operateurs autorises (geree par l'admin) :
       { username, nom (affiche), qualification, actif }
   - Operateur ACTIF : alimente automatiquement le profil global
     (CAEKProfil), qui signe toutes les actions importantes.
   - Stockage LOCAL uniquement (localStorage + IndexedDB "meta"),
     sans mot de passe. Aucune dependance Firebase a ce stade
     (migration cloud prevue plus tard).
   ============================================================ */
var CAEKOperateurs = (function () {
  "use strict";

  var LS_LIST = "caek_operateurs";
  var LS_ACTIF = "caek_operateur_actif";
  var META_LIST = "operateurs";
  var META_ACTIF = "operateurActif";

  var _list = null;        // tableau cache
  var _actif = undefined;  // username actif (string) ou null
  var _editing = null;     // username en cours d'edition (gestion)

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Identifiant technique a partir d'un nom (sans accents/espaces).
  function slug(s) {
    var base = String(s || "").trim().toLowerCase();
    if (base.normalize) { base = base.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
    return base || "op";
  }

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

  /* ---------- Mutations ---------- */
  // Definit l'operateur actif + alimente le profil global (signe les actions).
  function setActive(username) {
    loadCache();
    var op = find(username);
    if (!op || op.actif === false) { return Promise.resolve(null); }
    _actif = username;
    if (window.CAEKProfil) { CAEKProfil.save(op.nom, op.qualification, op.username); }
    var p = persist();
    renderAll();
    if (window.CAEKBadges) { CAEKBadges.refresh(); }
    return p.then(function () { return op; });
  }

  function logout() {
    _actif = null;
    if (window.CAEKProfil) { CAEKProfil.clear(); }
    persist();
    renderAll();
    if (window.CAEKApp) { CAEKApp.navigate("screen-login"); }
  }

  function add(op) {
    loadCache();
    var nom = (op && op.nom || "").trim();
    if (!nom) { return { ok: false, error: "Le nom affiché est obligatoire." }; }
    var qualification = (op && op.qualification || "").trim();
    var username = slug((op && op.username) || nom);
    var base = username, n = 2;
    while (find(username)) { username = base + "-" + n; n++; }
    _list.push({ username: username, nom: nom, qualification: qualification, actif: true });
    persist();
    return { ok: true, username: username };
  }

  function update(username, fields) {
    var op = find(username);
    if (!op) { return { ok: false }; }
    if (fields.nom !== undefined) { op.nom = String(fields.nom).trim() || op.nom; }
    if (fields.qualification !== undefined) { op.qualification = String(fields.qualification).trim(); }
    if (fields.actif !== undefined) { op.actif = !!fields.actif; }
    persist();
    // Si c'est l'operateur actif, on resynchronise le profil signataire.
    if (_actif === username && op.actif !== false && window.CAEKProfil) {
      CAEKProfil.save(op.nom, op.qualification, op.username);
    }
    return { ok: true };
  }

  function setActif(username, bool) {
    var r = update(username, { actif: !!bool });
    if (!bool && _actif === username) { logout(); }   // desactiver l'actif => deconnexion
    else { renderAll(); }
    return r;
  }

  // Migration douce : si aucun operateur mais un profil deja renseigne,
  // on cree un operateur a partir de ce profil et on l'active (continuite).
  function migrateFromProfilObj(p) {
    loadCache();
    if (_list.length || !p || !p.nom) { return; }
    var username = slug(p.nom);
    _list.push({ username: username, nom: p.nom, qualification: p.qualification || "", actif: true });
    _actif = username;
    persist();
  }

  /* ---------- Rendu ---------- */
  function opLine(o) {
    return escapeHtml(o.nom) + (o.qualification ? " — " + escapeHtml(o.qualification) : "");
  }

  function renderLogin() {
    var sel = $("login-select");
    if (!sel) { return; }
    var ops = actifs();
    var empty = $("login-empty");
    if (empty) { empty.hidden = ops.length > 0; }
    sel.innerHTML = ops.map(function (o) {
      return "<option value=\"" + escapeHtml(o.username) + "\"" + (o.username === _actif ? " selected" : "") + ">" +
        opLine(o) + "</option>";
    }).join("");
    var go = $("login-go");
    if (go) { go.disabled = ops.length === 0; }
  }

  function operItemHtml(o) {
    var isActive = (o.username === _actif);
    var inactif = (o.actif === false);
    if (o.username === _editing) {
      return "<div class=\"oper-item is-editing\" data-username=\"" + escapeHtml(o.username) + "\">" +
        "<label class=\"field-label\">Nom affiché</label>" +
        "<input class=\"field oper-edit-nom\" type=\"text\" value=\"" + escapeHtml(o.nom) + "\">" +
        "<label class=\"field-label\">Qualification</label>" +
        "<input class=\"field oper-edit-qualif\" type=\"text\" value=\"" + escapeHtml(o.qualification || "") + "\">" +
        "<div class=\"oper-actions\">" +
          "<button type=\"button\" class=\"btn-primary\" data-act=\"enregistrer\" data-username=\"" + escapeHtml(o.username) + "\">&#128190; Enregistrer</button>" +
          "<button type=\"button\" class=\"btn-text\" data-act=\"annuler\" data-username=\"" + escapeHtml(o.username) + "\">Annuler</button>" +
        "</div></div>";
    }
    var badges = (isActive ? "<span class=\"oper-badge is-active\">Actif</span>" : "") +
      (inactif ? "<span class=\"oper-badge is-off\">Désactivé</span>" : "");
    var actions = "";
    if (!inactif && !isActive) {
      actions += "<button type=\"button\" class=\"btn-secondary\" data-act=\"activer\" data-username=\"" + escapeHtml(o.username) + "\">Activer</button>";
    }
    actions += "<button type=\"button\" class=\"btn-text\" data-act=\"modifier\" data-username=\"" + escapeHtml(o.username) + "\">Modifier</button>";
    if (inactif) {
      actions += "<button type=\"button\" class=\"btn-text\" data-act=\"reactiver\" data-username=\"" + escapeHtml(o.username) + "\">Réactiver</button>";
    } else {
      actions += "<button type=\"button\" class=\"btn-text oper-off\" data-act=\"desactiver\" data-username=\"" + escapeHtml(o.username) + "\">Désactiver</button>";
    }
    return "<div class=\"oper-item" + (inactif ? " is-inactive" : "") + (isActive ? " is-current" : "") + "\" data-username=\"" + escapeHtml(o.username) + "\">" +
      "<div class=\"oper-info\"><span class=\"oper-nom\">" + escapeHtml(o.nom) + "</span> " + badges +
        (o.qualification ? "<span class=\"oper-qualif\">" + escapeHtml(o.qualification) + "</span>" : "") +
        "<span class=\"oper-username\">@" + escapeHtml(o.username) + "</span></div>" +
      "<div class=\"oper-actions\">" + actions + "</div></div>";
  }

  function renderOperateurs() {
    var box = $("oper-liste");
    if (!box) { return; }
    var ops = list();
    if (!ops.length) {
      box.innerHTML = "<p class=\"hint\">Aucun opérateur. Ajoutez-en un ci-dessous.</p>";
      return;
    }
    box.innerHTML = ops.map(operItemHtml).join("");
  }

  function renderProfil() {
    var box = $("profil-active");
    if (!box) { return; }
    var a = getActive();
    box.innerHTML = a
      ? "<div class=\"profil-active-card\"><span class=\"profil-active-nom\">" + escapeHtml(a.nom) + "</span>" +
        (a.qualification ? "<span class=\"profil-active-qualif\">" + escapeHtml(a.qualification) + "</span>" : "") +
        "<span class=\"profil-active-user\">@" + escapeHtml(a.username) + "</span></div>"
      : "<p class=\"hint\">Aucun opérateur actif. Connectez-vous.</p>";
  }

  function renderAll() { renderLogin(); renderOperateurs(); renderProfil(); }

  /* ---------- Aiguillage (login / accueil) ---------- */
  function isOnLogin() {
    var s = $("screen-login");
    return !!(s && s.classList.contains("is-active"));
  }
  function gate() {
    if (!activeUsername()) {
      if (window.CAEKApp) { CAEKApp.navigate("screen-login", false); }
      try { history.replaceState({ screen: "screen-login" }, "", "#screen-login"); } catch (e) {}
    } else if (isOnLogin()) {
      if (window.CAEKApp) { CAEKApp.navigate("screen-accueil", false); }
      try { history.replaceState({ screen: "screen-accueil" }, "", "#screen-accueil"); } catch (e) {}
    }
  }

  /* ---------- Evenements ---------- */
  function operResult(html, isError) {
    var box = $("oper-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function onAdd() {
    var nom = ($("oper-add-nom") && $("oper-add-nom").value) || "";
    var username = ($("oper-add-username") && $("oper-add-username").value) || "";
    var qualif = ($("oper-add-qualif") && $("oper-add-qualif").value) || "";
    var r = add({ nom: nom, username: username, qualification: qualif });
    if (!r.ok) { operResult("&#9888; " + escapeHtml(r.error), true); return; }
    if ($("oper-add-nom")) { $("oper-add-nom").value = ""; }
    if ($("oper-add-username")) { $("oper-add-username").value = ""; }
    if ($("oper-add-qualif")) { $("oper-add-qualif").value = ""; }
    renderAll();
    operResult("&#10004; Opérateur ajouté : <strong>@" + escapeHtml(r.username) + "</strong>.", false);
  }

  function onListClick(ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-act]") : null;
    if (!btn) { return; }
    var act = btn.getAttribute("data-act");
    var u = btn.getAttribute("data-username");
    if (act === "activer") {
      setActive(u).then(function () { operResult("&#10004; Opérateur actif : <strong>" + escapeHtml(opLine(find(u))) + "</strong>.", false); });
    } else if (act === "modifier") {
      _editing = u; renderOperateurs();
    } else if (act === "annuler") {
      _editing = null; renderOperateurs();
    } else if (act === "enregistrer") {
      var item = btn.closest(".oper-item");
      var nom = item.querySelector(".oper-edit-nom").value;
      var qualif = item.querySelector(".oper-edit-qualif").value;
      update(u, { nom: nom, qualification: qualif });
      _editing = null; renderAll();
      operResult("&#10004; Opérateur mis à jour.", false);
    } else if (act === "desactiver") {
      if (!window.confirm("Désactiver cet opérateur ? Il ne pourra plus se connecter.")) { return; }
      setActif(u, false);
      operResult("Opérateur désactivé.", false);
    } else if (act === "reactiver") {
      setActif(u, true);
      operResult("Opérateur réactivé.", false);
    }
  }

  function wire() {
    var go = $("login-go");
    if (go) {
      go.addEventListener("click", function () {
        var sel = $("login-select");
        var u = sel ? sel.value : "";
        if (!u) { return; }
        setActive(u).then(function (op) { if (op && window.CAEKApp) { CAEKApp.navigate("screen-accueil"); } });
      });
    }
    var addBtn = $("oper-add-btn");
    if (addBtn) { addBtn.addEventListener("click", onAdd); }
    var lst = $("oper-liste");
    if (lst) { lst.addEventListener("click", onListClick); }
    var back = $("oper-back");
    if (back) {
      back.addEventListener("click", function () {
        if (window.CAEKApp) { CAEKApp.navigate(activeUsername() ? "screen-accueil" : "screen-login"); }
      });
    }
    var chg = $("profil-changer");
    if (chg) { chg.addEventListener("click", function () { if (window.CAEKApp) { CAEKApp.navigate("screen-login"); } }); }
  }

  /* ---------- Initialisation ---------- */
  function afterLoad(durableProfil) {
    loadCache();
    if (_list.length === 0) {
      // Migration depuis un profil existant (localStorage OU IndexedDB durable).
      var p = (window.CAEKProfil && CAEKProfil.isRenseigne()) ? CAEKProfil.get()
            : (durableProfil && durableProfil.nom ? durableProfil : null);
      migrateFromProfilObj(p);
    }
    var a = getActive();
    if (a && window.CAEKProfil) { CAEKProfil.save(a.nom, a.qualification, a.username); }
    renderAll();
    gate();
  }

  function init() {
    loadCache();
    wire();
    renderAll();
    gate();   // decision immediate depuis localStorage
    // Reconciliation depuis le stockage durable (IndexedDB), profil inclus.
    if (window.CAEKDB && CAEKDB.getMeta) {
      Promise.all([
        CAEKDB.getMeta(META_LIST), CAEKDB.getMeta(META_ACTIF), CAEKDB.getMeta("profilOperateur")
      ]).then(function (o) {
        // Ne jamais ecraser une liste locale par une lecture durable vide.
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
    setActive: setActive,
    logout: logout,
    add: add,
    update: update,
    setActif: setActif,
    renderAll: renderAll
  };
})();
