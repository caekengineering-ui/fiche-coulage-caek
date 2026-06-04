/* ============================================================
   Fiche de coulage terrain - CAEK
   app.js - T1 : navigation entre ecrans + init PWA
   Aucune logique metier (pas d'UPDATE, pas de compteur,
   pas de fiche, pas de photo, pas d'export).
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Navigation entre ecrans ---------- */
  function showScreen(id) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove("is-active");
    }
    var target = document.getElementById(id);
    if (target) {
      target.classList.add("is-active");
      window.scrollTo(0, 0);
    }
    onScreenShown(id);
  }

  // Hook : rafraichit le contenu dynamique quand un ecran s'affiche
  function onScreenShown(id) {
    if (id === "screen-nouveau" && window.CAEKNouveau) { CAEKNouveau.refresh(); }
    if (id === "screen-update") { refreshUpdateStatus(); }
    if (id === "screen-repertoire" && window.CAEKRepertoire) { CAEKRepertoire.refresh(); }
  }

  // Navigation exposee aux autres modules
  window.CAEKApp = { navigate: navigateTo };

  function navigateTo(id, push) {
    showScreen(id);
    if (push !== false) {
      history.pushState({ screen: id }, "", "#" + id);
    }
  }

  // Boutons tuiles + retour : tout element [data-goto]
  document.addEventListener("click", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-goto]") : null;
    if (!el) { return; }
    navigateTo(el.getAttribute("data-goto"));
  });

  // Bouton "precedent" du telephone
  window.addEventListener("popstate", function (ev) {
    var id = (ev.state && ev.state.screen) ? ev.state.screen : "screen-accueil";
    showScreen(id);
  });

  // Etat initial : accueil (ou ancre presente dans l'URL)
  document.addEventListener("DOMContentLoaded", function () {
    var initial = (location.hash || "").replace("#", "") || "screen-accueil";
    if (!document.getElementById(initial)) { initial = "screen-accueil"; }
    history.replaceState({ screen: initial }, "", "#" + initial);
    showScreen(initial);
  });

  /* ---------- Ecran "Mise a jour projet" (T2) ---------- */
  function fmtDate(iso) {
    if (!iso) { return "—"; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return "—"; }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() +
      " à " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function refreshUpdateStatus() {
    if (!window.CAEKDB) { return; }
    Promise.all([
      CAEKDB.getMeta("lastImportDate"),
      CAEKDB.countProjets(),
      CAEKDB.getMeta("lastImportFileName")
    ]).then(function (out) {
      var dateEl = document.getElementById("status-date");
      var countEl = document.getElementById("status-count");
      var fileEl = document.getElementById("status-file");
      if (dateEl) { dateEl.textContent = out[0] ? fmtDate(out[0]) : "Aucun import pour l'instant"; }
      if (countEl) { countEl.textContent = out[1]; }
      if (fileEl) { fileEl.textContent = out[2] || "—"; }
    });
  }

  function showResult(html, isError) {
    var box = document.getElementById("update-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function handleFile(file) {
    if (!file) { return; }
    var reader = new FileReader();
    reader.onload = function () {
      CAEKUpdate.importBuffer(reader.result, file.name).then(function (bilan) {
        if (!bilan.ok) { showResult("&#9888; " + escapeHtml(bilan.error), true); return; }
        var msg = "&#10004; Import réussi : <strong>" + bilan.ajoutes +
          "</strong> ajouté(s), <strong>" + bilan.misAJour + "</strong> mis à jour.";
        var warn = [];
        if (bilan.ignorees) { warn.push(bilan.ignorees + " ligne(s) ignorée(s) (code, entreprise ou nom manquant)"); }
        if (bilan.doublons) { warn.push(bilan.doublons + " doublon(s) de code dans le fichier"); }
        if (bilan.resInvalides) { warn.push(bilan.resInvalides + " résistance(s) non numérique(s) ignorée(s)"); }
        if (warn.length) { msg += "<div class=\"warn\">&#9888; " + escapeHtml(warn.join(" · ")) + "</div>"; }
        showResult(msg, false);
        refreshUpdateStatus();
        renderProjetsListe(true);
      }).catch(function (err) {
        showResult("&#9888; Erreur lors de l'import : " + escapeHtml(err && err.message), true);
      });
    };
    reader.onerror = function () { showResult("&#9888; Lecture du fichier impossible.", true); };
    reader.readAsArrayBuffer(file);
  }

  function renderProjetsListe(forceShow) {
    var box = document.getElementById("update-liste");
    if (!box) { return; }
    CAEKDB.getAllProjets().then(function (list) {
      list.sort(function (a, b) { return a.codeProjet.localeCompare(b.codeProjet); });
      if (!list.length) {
        box.innerHTML = "<p class=\"hint\">Aucun projet en mémoire.</p>";
      } else {
        var rows = list.map(function (p) {
          return "<li><span class=\"pcode\">" + escapeHtml(p.codeProjet) + "</span>" +
            "<span class=\"pent\">" + escapeHtml(p.entreprise) + "</span>" +
            "<span class=\"pnom\">" + escapeHtml(p.nomProjet) + "</span></li>";
        }).join("");
        box.innerHTML = "<ul class=\"plist\">" + rows + "</ul>";
      }
      if (forceShow) { box.hidden = false; }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var input = document.getElementById("update-file");
    if (input) {
      input.addEventListener("change", function () {
        handleFile(input.files && input.files[0]);
        input.value = ""; // permet de reimporter le meme fichier
      });
    }
    var btnVoir = document.getElementById("btn-voir-projets");
    if (btnVoir) {
      btnVoir.addEventListener("click", function () {
        var box = document.getElementById("update-liste");
        if (!box) { return; }
        if (box.hidden) { renderProjetsListe(true); btnVoir.textContent = "Masquer les projets"; }
        else { box.hidden = true; btnVoir.textContent = "Voir les projets chargés"; }
      });
    }
    refreshUpdateStatus();

    if (window.CAEKNouveau) { CAEKNouveau.init(); }
    if (window.CAEKFiche) { CAEKFiche.init(); }
    if (window.CAEKPhotos) { CAEKPhotos.init(); }
    if (window.CAEKRepertoire) { CAEKRepertoire.init(); }
  });

  /* ---------- Service Worker (hors-ligne) ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (err) {
        console.warn("Service Worker non enregistre :", err);
      });
    });
  }
})();
