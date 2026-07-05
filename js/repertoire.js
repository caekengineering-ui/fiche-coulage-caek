/* ============================================================
   Module Béton - CAEK
   repertoire.js - V3 : liste des fiches + recherche/filtre (serveur).

   Cycle V3 : brouillon -> SOUMIS (opérateur, verrouillé, en attente
   admin) -> VALIDÉ (admin). Le renvoi admin remet en brouillon avec
   un motif affiché sur la fiche.

   Actions par fiche :
     - Ouvrir / modifier (brouillon) ou consulter (soumis/validé) ;
     - Soumettre au laboratoire (brouillon -> soumis : dispo pour le
       bassin, la validation admin arrive en parallèle) ;
     - Confirmer la récupération des éprouvettes (étiquettes) ;
     - Message récap (partage texte WhatsApp) — les exports fichiers
       (Excel/ZIP) sont supprimés : tout est sur le serveur.
     - Suppression : brouillons uniquement (local + serveur).
   ============================================================ */

var CAEKRepertoire = (function () {
  "use strict";

  var _all = [];
  var _statut = "";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(d) {
    if (!d) { return ""; }
    var s = String(d);
    if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var parts = s.split("-");
    return parts.length === 3 ? (parts[2] + "/" + parts[1] + "/" + parts[0]) : s;
  }

  var STATUT_LABEL = {
    brouillon: "Brouillon", soumis: "Soumis", valide: "Validé",
    validee: "Validée", envoyee: "Envoyé"   // anciens statuts locaux (rétro-compat)
  };

  // Un coulage « engagé » (non brouillon) alimente le bassin.
  function isEngagee(st) { return st === "soumis" || st === "valide" || st === "validee" || st === "envoyee"; }

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Difference en jours (b - a) entre deux dates "YYYY-MM-DD".
  function diffDays(a, b) {
    function toD(ymd) {
      var p = String(ymd).slice(0, 10).split("-");
      return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    return Math.round((toD(b) - toD(a)) / 86400000);
  }

  var TYPE_LABEL = { cube: "Cube", cylindre: "Cylindre", mixte: "Mixte (cube + cylindre)" };

  // Date de reference du coulage (pour le delai de recuperation, max 3 jours).
  function coulageDateStr(c) {
    var d = c.dateCoulage || c.dateSoumission || c.dateCreation || "";
    return String(d).slice(0, 10);
  }

  // Panneau « Confirmer recuperation des eprouvettes » : codification par
  // prelevement + 2 cases a cocher (recuperees / codification confirmee).
  function recupPanelHtml(c, ref) {
    var codif = window.CAEKModel ? CAEKModel.codification(c) : [];
    var total = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;

    var rows = codif.map(function (p) {
      var codesHtml = (p.codes || []).map(function (code) {
        return "<div class=\"recup-code\">" + escapeHtml(code) + "</div>";
      }).join("");
      return "<div class=\"recup-prel\">" +
        "<div class=\"recup-prel-head\"><strong>" + escapeHtml(p.numero) + "</strong> · " +
        escapeHtml(TYPE_LABEL[p.type] || p.type) + " · " + p.nombre + " épr." +
        (p.malaxeur ? " · Malaxeur " + p.malaxeur : "") + " :</div>" +
        "<div class=\"recup-prel-codes\">" + codesHtml + "</div>" +
        "</div>";
    }).join("");

    var cd = coulageDateStr(c);
    var delaiHtml = "";
    if (cd) {
      var d = diffDays(cd, todayStr());
      var cls = d > 3 ? "is-error" : (d === 3 ? "is-warn" : "is-ok");
      var txt = d <= 0 ? "Coulage du jour"
        : (d === 1 ? "1 jour depuis le coulage"
          : d + " jours depuis le coulage");
      if (d > 3) { txt += " — délai de 3 j dépassé"; }
      delaiHtml = "<div class=\"recup-delai " + cls + "\">&#9201; " + txt + "</div>";
    }

    return "<div class=\"rep-recup\" hidden>" +
      "<p class=\"recup-title\">Récupération des éprouvettes — <strong>" + total + "</strong> au total</p>" +
      delaiHtml +
      "<div class=\"recup-etiquettes\">" +
      "<div class=\"recup-etiq-titre\">🏷️ ÉTIQUETTES À INSCRIRE SUR LES ÉPROUVETTES</div>" +
      "<div class=\"recup-liste\">" + rows + "</div>" +
      "</div>" +
      "<label class=\"recup-check\"><input type=\"checkbox\" class=\"recup-c1\" data-ref=\"" + ref + "\"> " +
      "Les éprouvettes ont été récupérées du chantier.</label>" +
      "<label class=\"recup-check\"><input type=\"checkbox\" class=\"recup-c2\" data-ref=\"" + ref + "\"> " +
      "La codification ci-dessus a été vérifiée et confirmée.</label>" +
      "<button type=\"button\" class=\"btn-primary rep-recup-valider\" data-ref=\"" + ref + "\" disabled>" +
      "&#10004; Confirmer la récupération</button>" +
      "<div class=\"rep-recup-result\" hidden></div>" +
      "</div>";
  }

  // Totaux terrain : quantite (m3) sur les malaxeurs, nombre d'eprouvettes.
  function totaux(c) {
    var mals = c.malaxeurs || [];
    var qte = 0;
    for (var i = 0; i < mals.length; i++) {
      qte += num(mals[i].quantite);
    }
    qte = Math.round(qte * 100) / 100;
    var epr = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;
    return { qte: qte, epr: epr };
  }

  function loadLocal() {
    return CAEKDB.getAllCoulages().then(function (list) {
      list.sort(function (a, b) {
        var da = a.dateModification || a.dateCreation || "";
        var db = b.dateModification || b.dateCreation || "";
        return db.localeCompare(da);
      });
      _all = list;
    });
  }

  function refresh() {
    if (!window.CAEKDB) { return; }
    loadLocal().then(render);
    // Rapatrie les changements serveur (validation/renvoi admin, fiches
    // des collègues du labo) puis réaffiche si nécessaire.
    if (window.CAEKCoulages) {
      CAEKCoulages.pull().then(function (r) {
        if (r && r.changed) { loadLocal().then(render); }
      });
    }
  }

  function filteredList() {
    var search = ($("rep-search") ? $("rep-search").value : "").trim().toLowerCase();
    return _all.filter(function (c) {
      // Filtre labo (administrateur seulement ; opérateur déjà scopé serveur).
      if (window.CAEKLaboFilter && !CAEKLaboFilter.match(c.laboId)) { return false; }
      var st = c.statut || "brouillon";
      if (_statut === "soumis" && !(st === "soumis" || st === "validee" || st === "envoyee")) { return false; }
      else if (_statut === "valide" && st !== "valide") { return false; }
      else if (_statut === "brouillon" && st !== "brouillon") { return false; }
      if (!search) { return true; }
      var hay = [c.ref, c.codeProjet, c.entreprise, c.client, c.nomProjet,
        fmtDate(c.dateCoulage), c.dateCoulage].join(" ").toLowerCase();
      return hay.indexOf(search) >= 0;
    });
  }

  function render() {
    var box = $("rep-liste");
    if (!box) { return; }

    var filtered = filteredList();

    if ($("rep-count")) {
      $("rep-count").textContent = filtered.length + " fiche(s)";
    }

    if (!filtered.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucune fiche enregistrée pour ce filtre.</p>";
      return;
    }

    box.innerHTML = filtered.map(function (c) {
      var st = c.statut || "brouillon";
      var t = totaux(c);
      var ref = escapeHtml(c.ref);

      var needRecup = isEngagee(st) && window.CAEKModel &&
        CAEKModel.hasEprouvettes(c) && !CAEKModel.recuperationOk(c);

      // Bandeau : renvoi par l'admin (fiche repassée en brouillon).
      var retour = (st === "brouillon" && c.retourAdmin)
        ? "<div class=\"result-card is-error rep-retour\">&#8617; <strong>Renvoyé par l'administrateur :</strong> " +
          escapeHtml(c.retourAdmin) + "</div>"
        : "";

      var actions = "<div class=\"rep-actions\">";
      if (st === "brouillon") {
        actions += "<button type=\"button\" class=\"rep-act rep-soumettre\" data-ref=\"" + ref + "\">&#128228; Soumettre au laboratoire</button>";
      } else {
        if (needRecup) {
          actions += "<button type=\"button\" class=\"rep-act rep-recup-btn\" data-ref=\"" + ref + "\">&#9888; Confirmer récupération éprouvettes</button>";
        }
        actions += "<button type=\"button\" class=\"rep-act rep-msg-btn\" data-ref=\"" + ref + "\">&#128172; Message récap</button>";
      }
      actions += "</div>";

      var recupPanel = needRecup ? recupPanelHtml(c, ref) : "";

      var msgPanel = "<div class=\"rep-export\" hidden>" +
        "<button type=\"button\" class=\"btn-primary rep-share-msg\" data-ref=\"" + ref + "\">&#128228; Partager le message (WhatsApp…)</button>" +
        "<button type=\"button\" class=\"btn-secondary rep-copy\" data-ref=\"" + ref + "\">&#128203; Copier le message récap</button>" +
        "<div class=\"rep-export-result\" hidden></div>" +
        "</div>";

      var validInfo = (st === "valide" && c.validePar)
        ? "<div class=\"rep-sub\">&#9989; Validé par " + escapeHtml(c.validePar) +
          (c.dateValidation ? " le " + escapeHtml(c.dateValidation) : "") + "</div>"
        : "";

      var delBtn = (st === "brouillon")
        ? "<button type=\"button\" class=\"rep-del\" data-del=\"" + ref + "\" " +
          "aria-label=\"Supprimer la fiche " + ref + "\" title=\"Supprimer\">&#128465;</button>"
        : "";

      return "<div class=\"rep-item\" data-ref=\"" + ref + "\">" +
        retour +
        "<div class=\"rep-row\">" +
        "<button type=\"button\" class=\"rep-open\" data-ref=\"" + ref + "\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">" + ref + "</span>" +
        "<span class=\"badge badge-" + st + "\">" + (STATUT_LABEL[st] || st) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(c.nomProjet || "") +
        (c.dateCoulage ? " · " + escapeHtml(fmtDate(c.dateCoulage)) : "") + "</div>" +
        validInfo +
        "<div class=\"rep-tot\">" + t.qte + " m³ · " + t.epr + " éprouvette(s)</div>" +
        "</button>" +
        delBtn +
        "</div>" +
        actions +
        recupPanel +
        msgPanel +
        "</div>";
    }).join("");
  }

  /* ---------- Soumission (brouillon -> soumis) ---------- */
  function soumettreFiche(ref) {
    var prof = window.CAEKProfil ? CAEKProfil.require("Profil opérateur requis. Connectez-vous.") : { nom: "" };
    if (!prof) { return; }
    if (!window.confirm("Soumettre la fiche " + ref + " au laboratoire ?\n" +
      "Elle sera verrouillée et envoyée à l'administrateur pour validation.\n" +
      "La répartition des éprouvettes au bassin reste possible immédiatement.")) { return; }
    if (!window.CAEKCoulages) { return; }
    CAEKCoulages.soumettre(ref, prof).then(function (r) {
      if (!r.ok) { window.alert(r.error || "Échec de la soumission."); refresh(); return; }
      if (r.offline) {
        window.alert("Fiche soumise (hors-ligne) : elle sera transmise au serveur au retour du réseau.");
      }
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
      refresh();
    });
  }

  /* ---------- Message récap (seul « export » conservé) ---------- */
  function exportResultBox(itemEl, html, isError) {
    var box = itemEl.querySelector(".rep-export-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "rep-export-result result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function withCoulage(ref, fn) { return CAEKDB.getCoulage(ref).then(function (c) { if (c) { return fn(c); } }); }

  function doShareMsg(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      var t = CAEKExport.buildMessage(c);
      if (navigator.share) {
        return navigator.share({ text: t }).then(function () {
          exportResultBox(itemEl, "&#10004; Message partagé.", false);
        }).catch(function () { /* annulé */ });
      }
      window.prompt("Copier le message :", t);
    });
  }

  function doCopyMsg(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      var t = CAEKExport.buildMessage(c);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(
          function () { exportResultBox(itemEl, "&#10004; Message récap copié.", false); },
          function () { window.prompt("Copier le message :", t); });
      } else { window.prompt("Copier le message :", t); }
    });
  }

  /* ---------- Confirmation de recuperation des eprouvettes ---------- */
  function recupResultBox(itemEl, html, isError) {
    var box = itemEl.querySelector(".rep-recup-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "rep-recup-result result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function confirmRecuperation(ref, itemEl) {
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour confirmer la récupération des éprouvettes.")
      : { nom: "" };
    if (!prof) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return; }
      c.eprRecuperees = true;
      c.codificationConfirmee = true;
      c.dateRecuperation = new Date().toISOString();
      c.operateurRecuperation = prof.nom || c.signatureOperateur || "";
      c.qualificationRecuperation = prof.qualification || "";
      c.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(c).then(function () {
        recupResultBox(itemEl, "&#10004; Récupération confirmée. Le coulage peut être réparti au bassin.", false);
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
        refresh();
      });
    }).catch(function (err) {
      recupResultBox(itemEl, "&#9888; " + escapeHtml(err && err.message || err), true);
    });
  }

  function init() {
    var s = $("rep-search");
    if (s) { s.addEventListener("input", render); }

    var chips = $("rep-filtres");
    if (chips) {
      chips.addEventListener("click", function (ev) {
        var c = ev.target.closest ? ev.target.closest(".chip") : null;
        if (!c) { return; }
        _statut = c.getAttribute("data-statut") || "";
        var all = chips.querySelectorAll(".chip");
        for (var i = 0; i < all.length; i++) { all[i].classList.remove("is-active"); }
        c.classList.add("is-active");
        render();
      });
    }

    var box = $("rep-liste");
    if (box) {
      box.addEventListener("click", function (ev) {
        var tgt = ev.target;
        var item = tgt.closest ? tgt.closest(".rep-item") : null;

        var del = tgt.closest ? tgt.closest(".rep-del") : null;
        if (del) {
          ev.stopPropagation();
          var dref = del.getAttribute("data-del");
          if (dref && window.confirm("Voulez-vous vraiment supprimer la fiche " + dref + " ? Cette action est irréversible.")) {
            CAEKDB.deleteCoulage(dref).then(function () {
              if (window.CAEKCoulages) { CAEKCoulages.deleteOnServer(dref); }
              refresh();
            });
          }
          return;
        }

        var sm = tgt.closest ? tgt.closest(".rep-soumettre") : null;
        if (sm) { soumettreFiche(sm.getAttribute("data-ref")); return; }

        var mg = tgt.closest ? tgt.closest(".rep-msg-btn") : null;
        if (mg && item) {
          var panel = item.querySelector(".rep-export");
          if (panel) { panel.hidden = !panel.hidden; }
          return;
        }

        var rb = tgt.closest ? tgt.closest(".rep-recup-btn") : null;
        if (rb && item) {
          var rpanel = item.querySelector(".rep-recup");
          if (rpanel) { rpanel.hidden = !rpanel.hidden; }
          return;
        }

        var rv = tgt.closest ? tgt.closest(".rep-recup-valider") : null;
        if (rv && item) {
          if (rv.disabled) { return; }
          confirmRecuperation(rv.getAttribute("data-ref"), item);
          return;
        }

        var sh = tgt.closest ? tgt.closest(".rep-share-msg") : null;
        if (sh && item) { doShareMsg(sh.getAttribute("data-ref"), item); return; }
        var cp = tgt.closest ? tgt.closest(".rep-copy") : null;
        if (cp && item) { doCopyMsg(cp.getAttribute("data-ref"), item); return; }

        var open = tgt.closest ? tgt.closest(".rep-open") : null;
        if (open) {
          var ref = open.getAttribute("data-ref");
          if (ref && window.CAEKFiche) { CAEKFiche.open(ref); }
        }
      });

      box.addEventListener("change", function (ev) {
        var chk = ev.target;
        // Cases a cocher de recuperation : activer le bouton quand les 2 sont cochees.
        if (!chk || !chk.classList ||
          !(chk.classList.contains("recup-c1") || chk.classList.contains("recup-c2"))) {
          return;
        }
        var panel = chk.closest ? chk.closest(".rep-recup") : null;
        if (!panel) { return; }
        var c1 = panel.querySelector(".recup-c1");
        var c2 = panel.querySelector(".recup-c2");
        var btn = panel.querySelector(".rep-recup-valider");
        if (btn) { btn.disabled = !(c1 && c1.checked && c2 && c2.checked); }
      });
    }
  }

  return { init: init, refresh: refresh };
})();
