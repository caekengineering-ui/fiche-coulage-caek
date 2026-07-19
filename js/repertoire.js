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

  function num(v) { var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v); var n = parseFloat(s.replace(",", ".")); return isNaN(n) ? 0 : n; }

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

  var _outbox = {};   // ref -> entrée outbox en attente (état de synchro visible)

  function loadLocal() {
    return CAEKDB.getAllCoulages().then(function (list) {
      list.sort(function (a, b) {
        var da = a.dateModification || a.dateCreation || "";
        var db = b.dateModification || b.dateCreation || "";
        return db.localeCompare(da);
      });
      _all = list;
      _outbox = {};
      if (!CAEKDB.outboxAll) { return; }
      return CAEKDB.outboxAll().then(function (entries) {
        (entries || []).forEach(function (e) {
          if (!e.ackAt) { _outbox[e.ref] = e; }
        });
      }).catch(function () {});
    });
  }

  /* ---------- Phase 2 : « Dupliquer les informations » ----------
     Nouvelle fiche brouillon pré-remplie avec l'IDENTIFICATION du coulage
     source. VIDÉS volontairement : référence, malaxeurs, prélèvements,
     résultats, médias, validations et traces d'audit. */
  function dupliquerFiche(ref) {
    if (!window.CAEKDB) { return; }
    CAEKDB.getCoulage(ref).then(function (src) {
      if (!src) { return; }
      var confirmMsg = "Créer une fiche similaire depuis " + ref + " ?\n\n" +
        "Seront copiés : client, projet, ouvrage, centrale et formulation.\n" +
        "Ne seront PAS copiés : date, malaxeurs, prélèvements, résultats, médias et validations.\n\n" +
        "La nouvelle fiche restera un brouillon supprimable jusqu'à sa soumission.";
      if (!window.confirm(confirmMsg)) { return; }
      var uuid = (window.CAEKCoulages && CAEKCoulages.newUuid) ? CAEKCoulages.newUuid()
        : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
      var base = {
        uuid: uuid,
        codeProjet: src.codeProjet || "",
        mode: src.mode || "projet",
        statut: "brouillon",
        dateCreation: new Date().toISOString(),
        dateCoulage: "",
        origineDuplication: ref,
        copieIntacte: true,
        statutSaisie: "incomplete",
        // Identification conservée
        clientId: src.clientId || "", entreprise: src.entreprise || "", client: src.client || "",
        nomProjet: src.nomProjet || "", localisation: src.localisation || "",
        adresse: src.adresse || "", ville: src.ville || "",
        contact: src.contact || "", contactNom: src.contactNom || "", contactTel: src.contactTel || "",
        email: src.email || "",
        referenceCommande: src.referenceCommande || "", referenceDossier: src.referenceDossier || "",
        resistance: src.resistance === undefined ? "" : src.resistance,
        laboId: src.laboId || "",
        agesEssai: Array.isArray(src.agesEssai) ? src.agesEssai.slice() : [7, 28],
        // Contexte terrain conservé (re-modifiable)
        modeCoulage: src.modeCoulage || "", modeCoulageAutre: src.modeCoulageAutre || "",
        ouvrages: Array.isArray(src.ouvrages) ? src.ouvrages.slice() : [],
        ouvrageFamilies: Array.isArray(src.ouvrageFamilies) ? src.ouvrageFamilies.slice() : [],
        ouvrageAutre: src.ouvrageAutre || "", ouvrageCoule: src.ouvrageCoule || "",
        bloc: src.bloc || "", etage: src.etage || "", partie: "",
        ouvrageZonePartie: src.ouvrageZonePartie || "",
        designationTerrain: src.designationTerrain || src.ouvrageCoule || "",
        // Phase 2 : centrale / formulation / quantité estimée conservées
        centrale: src.centrale || "", formulationId: src.formulationId || "",
        quantiteEstimee: src.quantiteEstimee || "",
        // VIDÉS : mesures, prélèvements, résultats, médias, validations, audit
        malaxeurs: []
      };
      function creer(newRef, numero, prov) {
        base.ref = newRef;
        base.numero = numero;
        base.refProvisoire = prov;
        CAEKDB.saveCoulage(base).then(function (res) {
          if (!res.ok) { window.alert(res.error || "Duplication impossible."); return; }
          if (window.CAEKCoulages && CAEKCoulages.registerLocalDraft) {
            CAEKCoulages.registerLocalDraft(newRef).catch(function () {});
          }
          if (window.CAEKFiche) { CAEKFiche.open(newRef); }
          else { refresh(); }
        });
      }
      // La référence reste clairement provisoire à la création. La Phase 1
      // l'échange atomiquement contre une référence officielle au serveur.
      creer((base.codeProjet || "FICHE") + "-P" + String(uuid).replace(/-/g, "").slice(0, 6).toUpperCase(), null, true);
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

      // Phase 1 : CONFLIT DE VERSIONS visible, à résoudre explicitement.
      if (c._conflit) {
        var srvC = c._conflit;
        retour += "<div class=\"result-card is-error rep-conflit\">&#9888; <strong>Conflit de versions :</strong> " +
          "cette fiche a été modifiée sur un autre appareil" +
          (srvC.operateur ? " par " + escapeHtml(srvC.operateur) : "") +
          (srvC.version ? " (version serveur " + escapeHtml(String(srvC.version)) + ")" : "") + "." +
          "<div class=\"rep-actions\">" +
          "<button type=\"button\" class=\"rep-act rep-conflit-serveur\" data-ref=\"" + ref + "\">&#11015; Prendre la version serveur</button>" +
          "<button type=\"button\" class=\"rep-act rep-conflit-local\" data-ref=\"" + ref + "\">&#11014; Garder mes modifications et renvoyer</button>" +
          "</div></div>";
      }
      // État de synchronisation : en attente / erreur consignée (outbox).
      var ob = _outbox[c.ref];
      if (ob && !c._conflit) {
        retour += "<div class=\"result-card rep-attente\">&#8987; " +
          (ob.action === "soumettre" ? "Soumission" : "Sauvegarde") + " en attente de synchronisation" +
          (ob.attempts ? " · " + ob.attempts + " tentative(s)" : "") +
          (ob.lastError ? " · <strong>Dernière erreur :</strong> " + escapeHtml(ob.lastError) : "") +
          "</div>";
      }

      var actions = "<div class=\"rep-actions\">";
      if (st === "brouillon") {
        if (c.statutSaisie === "incomplete") {
          actions += "<button type=\"button\" class=\"rep-act rep-resume\" data-ref=\"" + ref + "\">&#9654; Reprendre la saisie</button>";
        } else {
          actions += "<button type=\"button\" class=\"rep-act rep-soumettre\" data-ref=\"" + ref + "\">&#128228; Soumettre au laboratoire</button>";
        }
      } else {
        if (needRecup) {
          actions += "<button type=\"button\" class=\"rep-act rep-recup-btn\" data-ref=\"" + ref + "\">&#9888; Confirmer récupération éprouvettes</button>";
        }
        actions += "<button type=\"button\" class=\"rep-act rep-msg-btn\" data-ref=\"" + ref + "\">&#128172; Message récap</button>";
      }
      actions += "</div>";

      var moreMenu = "<div class=\"rep-more-wrap\">" +
        "<button type=\"button\" class=\"btn-text rep-more-toggle\" aria-expanded=\"false\" aria-label=\"Autres actions\">&#8942; Autres actions</button>" +
        "<div class=\"rep-more-menu\" hidden>" +
        "<button type=\"button\" class=\"rep-act rep-dupliquer\" data-ref=\"" + ref + "\">&#128209; Créer une fiche similaire</button>" +
        "</div></div>";

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

      var canDelete = st === "brouillon" ||
        (window.CAEKOperateurs && CAEKOperateurs.isAdmin && CAEKOperateurs.isAdmin());
      var delBtn = canDelete
        ? "<button type=\"button\" class=\"rep-del\" data-del=\"" + ref + "\" " +
          "aria-label=\"Supprimer la fiche " + ref + "\" title=\"Supprimer\">&#128465;</button>"
        : "";

      return "<div class=\"rep-item\" data-ref=\"" + ref + "\">" +
        retour +
        "<div class=\"rep-row\">" +
        "<button type=\"button\" class=\"rep-open\" data-ref=\"" + ref + "\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">" + ref + "</span>" +
        (c.refProvisoire ? "<span class=\"badge badge-brouillon\" title=\"Référence officielle attribuée à la synchronisation\">Provisoire</span>" : "") +
        (c.statutSaisie === "incomplete" ? "<span class=\"badge badge-incomplete\">Incomplète</span>" : "") +
        (c.origineDuplication ? "<span class=\"badge badge-copy\">Fiche similaire</span>" : "") +
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
        moreMenu +
        recupPanel +
        msgPanel +
        "</div>";
    }).join("");
  }

  /* ---------- Soumission (brouillon -> soumis) ---------- */
  function soumettreFiche(ref) {
    var prof = window.CAEKProfil ? CAEKProfil.require("Profil opérateur requis. Connectez-vous.") : { nom: "" };
    if (!prof) { return; }
    if (!window.CAEKCoulages) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      var mals = (c && c.malaxeurs) || [];
      if (c && c.statutSaisie === "incomplete") {
        window.alert("Cette fiche est incomplète. Reprenez la saisie et terminez votre intervention avant de la soumettre.");
        return;
      }
      if (mals.length === 0) {
        window.alert(window.I18N && I18N.f
          ? I18N.f("Ajoutez au moins un malaxeur (quantité de béton) avant de soumettre la fiche.")
          : "Ajoutez au moins un malaxeur (quantité de béton) avant de soumettre la fiche.");
        return;
      }
      var recommande = parseInt(c.recommandationEprouvettes, 10) || 0;
      var reel = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;
      if (recommande > 0 && reel < recommande) {
        if (!window.confirm("Le laboratoire recommande " + recommande + " éprouvettes pour cette quantité, mais " +
          reel + " seulement ont été enregistrées.\n\nContinuer quand même vers la confirmation de soumission ?")) { return; }
      }
      var submitMsg = window.I18N && I18N.f
        ? I18N.f("Soumettre la fiche {ref} au laboratoire ?", { ref: ref }) + "\n" +
          I18N.f("Elle sera verrouillée et envoyée à l'administrateur pour validation.") + "\n" +
          I18N.f("La répartition des éprouvettes au bassin reste possible immédiatement.")
        : "Soumettre la fiche " + ref + " au laboratoire ?\n" +
          "Elle sera verrouillée et envoyée à l'administrateur pour validation.\n" +
          "La répartition des éprouvettes au bassin reste possible immédiatement.";
      if (!window.confirm(submitMsg)) { return; }
      CAEKCoulages.soumettre(ref, prof).then(function (r) {
        if (!r.ok) { window.alert(r.error || "Échec de la soumission."); refresh(); return; }
        if (r.offline) {
          window.alert("Fiche soumise (hors-ligne) : elle sera transmise au serveur au retour du réseau.");
        }
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
        refresh();
      });
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
        // Phase 3 : la récupération devient aussi un ÉVÉNEMENT SERVEUR
        // idempotent (op_coulage_event) — plus seulement un champ local.
        if (window.CAEKCoulages && CAEKCoulages.sendEvent) {
          CAEKCoulages.sendEvent(ref, "recuperation", {
            date: c.dateRecuperation, operateur: c.operateurRecuperation
          });
        }
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
          var deleteMsg = window.I18N && I18N.f
            ? I18N.f("Voulez-vous vraiment supprimer la fiche {ref} ? Cette action est irréversible.", { ref: dref })
            : "Voulez-vous vraiment supprimer la fiche " + dref + " ? Cette action est irréversible.";
          if (dref && window.confirm(deleteMsg)) {
            var isAdmin = window.CAEKOperateurs && CAEKOperateurs.isAdmin && CAEKOperateurs.isAdmin();
            var onlineAdminDelete = isAdmin && window.CAEKServer && CAEKServer.configured && CAEKServer.configured();
            var removeLocal = function () { return CAEKDB.deleteCoulage(dref).then(refresh); };
            if (onlineAdminDelete) {
              CAEKServer.adminDeleteCoulage(CAEKOperateurs.token(), dref).then(function (r) {
                if (!r || r.ok !== true) {
                  window.alert("Suppression impossible côté serveur.");
                  return;
                }
                removeLocal();
              }).catch(function (e) {
                window.alert("Suppression admin impossible : " + (e && e.message || e));
              });
            } else {
              CAEKDB.deleteCoulage(dref).then(function () {
                if (window.CAEKCoulages) { CAEKCoulages.deleteOnServer(dref); }
                refresh();
              });
            }
          }
          return;
        }

        var sm = tgt.closest ? tgt.closest(".rep-soumettre") : null;
        if (sm) { soumettreFiche(sm.getAttribute("data-ref")); return; }

        // Phase 1 : résolution EXPLICITE d'un conflit de versions.
        var cfS = tgt.closest ? tgt.closest(".rep-conflit-serveur") : null;
        if (cfS) {
          var refS = cfS.getAttribute("data-ref");
          if (window.confirm("Prendre la version serveur ?\nVos modifications locales non synchronisées seront abandonnées.")) {
            CAEKCoulages.resoudreConflit(refS, "serveur").then(refresh);
          }
          return;
        }
        var cfL = tgt.closest ? tgt.closest(".rep-conflit-local") : null;
        if (cfL) {
          var refL = cfL.getAttribute("data-ref");
          if (window.confirm("Garder vos modifications et les renvoyer au serveur ?\nElles remplaceront la version serveur actuelle.")) {
            CAEKCoulages.resoudreConflit(refL, "local").then(refresh);
          }
          return;
        }

        var more = tgt.closest ? tgt.closest(".rep-more-toggle") : null;
        if (more && item) {
          var menu = item.querySelector(".rep-more-menu");
          if (menu) { menu.hidden = !menu.hidden; more.setAttribute("aria-expanded", menu.hidden ? "false" : "true"); }
          return;
        }
        var dup = tgt.closest ? tgt.closest(".rep-dupliquer") : null;
        if (dup) {
          var dm = item && item.querySelector(".rep-more-menu"); if (dm) { dm.hidden = true; }
          dupliquerFiche(dup.getAttribute("data-ref")); return;
        }

        var resume = tgt.closest ? tgt.closest(".rep-resume") : null;
        if (resume) {
          var resumeRef = resume.getAttribute("data-ref");
          if (resumeRef && window.CAEKFiche) { CAEKFiche.open(resumeRef); }
          return;
        }

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
