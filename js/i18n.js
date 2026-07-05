"use strict";
/* ============================================================
   Module Béton - CAEK — Bilingue FR / AR (parcours opérateur).
   Moteur repris de l'app « Essai de contrôle in situ » :
   - Clé = texte français affiché ; valeur = traduction arabe.
   - Traduit le HTML statique ET le contenu généré (MutationObserver).
   - Les JETONS TECHNIQUES ne sont jamais traduits (C25/30, MPa, Rc,
     Dmax, kg/m³, EV, 7j/28j, E1, ABA001, Ø, cm…) : ils ne figurent
     pas dans le dictionnaire et sont isolés en LTR par le CSS.
   - Le PV / les documents bureau restent en français (officiels).
   ============================================================ */
var I18N = (function () {
  var KEY = "caek-lang";
  var _lang = localStorage.getItem(KEY) || "fr";
  var _obs = null;

  var AR = {
    // ---- En-tête / accueil ----
    "Laboratoire béton": "مخبر الخرسانة",
    "Choisissez un module": "اختر الوحدة",
    "Coulage béton": "صبّ الخرسانة",
    "Bassin de conservation": "حوض الحفظ",
    "Test de compression": "اختبار الضغط",
    "Validation des coulages": "اعتماد عمليات الصبّ",
    "Vue laboratoire": "عرض المخبر",
    "Tous les laboratoires": "كل المخابر",

    // ---- Connexion ----
    "Connexion opérateur": "دخول المُشغّل",
    "Identifiant": "المعرّف",
    "Code PIN": "الرمز السري (PIN)",
    "Se connecter": "تسجيل الدخول",
    "Connexion…": "جارٍ الدخول…",
    "Saisissez l'identifiant et le code PIN fournis par l'administrateur.": "أدخل المعرّف والرمز السري المقدَّمين من المسؤول.",
    "Code PIN incorrect.": "الرمز السري (PIN) غير صحيح.",
    "Identifiant inconnu.": "المعرّف غير معروف.",
    "Compte désactivé : contactez l'administrateur.": "الحساب موقوف: اتصل بالمسؤول.",

    // ---- Profil ----
    "Profil opérateur": "ملف المُشغّل",
    "Changer d'opérateur": "تغيير المُشغّل",
    "Changer mon code PIN": "تغيير الرمز السري (PIN)",
    "Administration": "الإدارة",
    "Se déconnecter et changer d'opérateur ?": "تسجيل الخروج وتغيير المُشغّل؟",
    "Notifications": "الإشعارات",
    "Activer les notifications": "تفعيل الإشعارات",
    "Aucun opérateur connecté.": "لا يوجد مُشغّل متصل.",

    // ---- Sous-menu coulage ----
    "Nouveau coulage": "صبّ جديد",
    "Répertoire": "السجلّ",
    "Mise à jour projet": "تحديث المشروع",
    "Données & synchronisation": "البيانات والمزامنة",

    // ---- Bassin ----
    "À répartir": "للتوزيع",
    "Bassin virtuel": "الحوض الافتراضي",
    "Gestion déchets": "إدارة النفايات",

    // ---- Boutons / navigation communs ----
    "← Retour": "رجوع ↩",
    "Retour": "رجوع",
    "Annuler": "إلغاء",
    "Enregistrer": "حفظ",
    "Confirmer": "تأكيد",
    "Suivant": "التالي",
    "Terminer": "إنهاء",
    "Oui": "نعم", "Non": "لا",
    "Client": "الزبون",
    "Projet": "المشروع",
    "Date": "التاريخ",
    "Date du coulage": "تاريخ الصبّ",

    // ---- Nouveau coulage ----
    "Projet enregistré": "مشروع مسجّل",
    "Client simple": "زبون بسيط",
    "— Choisir un client —": "— اختر الزبون —",
    "— Choisir un projet —": "— اختر المشروع —",
    "Créer le brouillon": "إنشاء المسودّة",
    "N° de coulage (modifiable)": "رقم الصبّ (قابل للتعديل)",
    "Référence :": "المرجع :",

    // ---- Répertoire / statuts ----
    "Toutes": "الكل",
    "Brouillons": "مسودّات",
    "Soumises": "مُرسَلة",
    "Validées": "معتمَدة",
    "Brouillon": "مسودّة",
    "Soumis": "مُرسَل",
    "Validé": "معتمَد",
    "Testé": "مُختبَر",
    "Soumettre au laboratoire": "إرسال إلى المخبر",
    "Message récap": "رسالة موجزة",
    "Copier le message récap": "نسخ الرسالة الموجزة",
    "Partager le message (WhatsApp…)": "مشاركة الرسالة (واتساب…)",
    "Confirmer récupération éprouvettes": "تأكيد استرجاع العيّنات",
    "Confirmer la récupération": "تأكيد الاسترجاع",
    "Aucune fiche enregistrée pour ce filtre.": "لا توجد بطاقة مسجّلة لهذا المُرشّح.",

    // ---- Récupération / éprouvettes ----
    "Les éprouvettes ont été récupérées du chantier.": "تمّ استرجاع العيّنات من الورشة.",
    "La codification ci-dessus a été vérifiée et confirmée.": "تمّ التحقّق من الترميز أعلاه وتأكيده.",

    // ---- Répartition / bassin ----
    "Confirmer la répartition": "تأكيد التوزيع",
    "Échéance d'essai": "موعد الاختبار",
    "7 jours": "7 أيام", "28 jours": "28 يومًا", "Autre…": "أخرى…",
    "Diviser (âge client)": "تقسيم (عمر الزبون)",
    "Sortir pour essai": "إخراج للاختبار",
    "Aucune fiche à répartir pour l'instant.": "لا توجد بطاقة للتوزيع حاليًا.",

    // ---- Compression / écrasement ----
    "À tester": "للاختبار",
    "Historique": "السجلّ",
    "Résultats d'écrasement à valider": "نتائج السحق للاعتماد",
    "Valider les résultats": "اعتماد النتائج",
    "Coulages soumis": "عمليات الصبّ المُرسَلة",
    "Renvoyer pour correction": "إعادة للتصحيح",
    "Valider ce coulage": "اعتماد هذا الصبّ",

    // ---- Déchets ----
    "Appeler le camion d'évacuation": "استدعاء شاحنة الإجلاء",

    // ---- Messages généraux ----
    "Aucun coulage en attente de validation.": "لا يوجد صبّ في انتظار الاعتماد.",
    "Aucun résultat en attente.": "لا توجد نتيجة في الانتظار.",
    "Chargement…": "جارٍ التحميل…"
  };

  function lang() { return _lang; }
  function T(s) {
    if (_lang !== "ar" || s == null) { return s; }
    var k = String(s).trim();
    return AR[k] || s;
  }

  // emoji/pictogrammes/flèches de tête (pas les chiffres ni les lettres)
  var LEAD = new RegExp("^([\\u2190-\\u21FF\\u2300-\\u27BF\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}\\uFE0F\\u200D]+\\s*)([\\s\\S]+)$", "u");

  function _translateNode(n) {
    var raw = n.nodeValue;
    var t = raw.trim();
    if (!t) { return; }
    var tr = AR[t];
    if (tr) { if (n.__fr == null) { n.__fr = raw; } n.nodeValue = raw.replace(t, tr); return; }
    var m = t.match(LEAD);
    if (m && AR[m[2].trim()]) {
      if (n.__fr == null) { n.__fr = raw; }
      n.nodeValue = raw.replace(t, m[1] + AR[m[2].trim()]);
    }
  }

  function translate(root) {
    root = root || document.body;
    if (_lang !== "ar") { return; }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p) { return NodeFilter.FILTER_REJECT; }
        var tag = p.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "OPTION") { return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (w.nextNode()) { nodes.push(w.currentNode); }
    nodes.forEach(_translateNode);
    var phs = root.querySelectorAll ? root.querySelectorAll("[placeholder]") : [];
    for (var i = 0; i < phs.length; i++) {
      var el = phs[i];
      var t = (el.getAttribute("placeholder") || "").trim();
      if (AR[t]) { if (!el.dataset.frPh) { el.dataset.frPh = el.getAttribute("placeholder"); } el.setAttribute("placeholder", AR[t]); }
    }
  }

  function _restoreAll() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (w.nextNode()) { nodes.push(w.currentNode); }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.__fr != null) { n.nodeValue = n.__fr; n.__fr = null; }
    }
    var els = document.querySelectorAll("[data-fr-ph]");
    for (var j = 0; j < els.length; j++) {
      els[j].setAttribute("placeholder", els[j].dataset.frPh);
      delete els[j].dataset.frPh;
    }
  }

  function setLang(l) {
    _lang = (l === "ar") ? "ar" : "fr";
    localStorage.setItem(KEY, _lang);
    document.documentElement.lang = _lang;
    document.documentElement.dir = (_lang === "ar") ? "rtl" : "ltr";
    document.body.classList.toggle("lang-ar", _lang === "ar");
    _restoreAll();
    if (_lang === "ar") { translate(document.body); }
    _updateToggles();
  }

  function _updateToggles() {
    var btns = document.querySelectorAll("[data-lang-btn]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("is-active", btns[i].dataset.langBtn === _lang);
    }
  }

  function _bindToggles() {
    var btns = document.querySelectorAll("[data-lang-btn]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        if (b.__bound) { return; }
        b.__bound = true;
        b.addEventListener("click", function () { setLang(b.dataset.langBtn); });
      })(btns[i]);
    }
    _updateToggles();
  }

  function _observe() {
    if (_obs) { return; }
    _obs = new MutationObserver(function (muts) {
      if (_lang !== "ar") { return; }
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 1) { translate(node); }
          else if (node.nodeType === 3) { _translateNode(node); }
        }
      }
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    _bindToggles();
    _observe();
    setLang(_lang);
    var _alert = window.alert.bind(window);
    window.alert = function (m) {
      return _alert(String(m).split("\n").map(function (line) { return T(line); }).join("\n"));
    };
  }

  return { init: init, setLang: setLang, lang: lang, T: T, translate: translate };
})();

document.addEventListener("DOMContentLoaded", function () { I18N.init(); });
