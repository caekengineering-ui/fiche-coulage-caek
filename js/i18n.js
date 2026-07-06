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
  var _translating = false;

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
    "Profil non renseigné": "الملف غير مُعبّأ",
    "Profil opérateur non renseigné": "ملف المُشغّل غير مُعبّأ",
    "Opérateur connecté — il signe toutes vos actions (fiches, répartition, sorties, essais, déchets) :": "المُشغّل المتصل يوقّع كل إجراءاتك (البطاقات، التوزيع، الإخراج، الاختبارات، النفايات):",
    "Opérateur": "مُشغّل",
    "Administrateur": "مسؤول",
    "Aucun labo affecté": "لا يوجد مخبر معيّن",
    "Connecté": "متصل",
    "Se déconnecter et changer d'opérateur ?": "تسجيل الخروج وتغيير المُشغّل؟",
    "Notifications": "الإشعارات",
    "Activer les notifications": "تفعيل الإشعارات",
    "Désactiver sur cet appareil": "تعطيل على هذا الجهاز",
    "Cet appareil / navigateur ne gère pas les notifications.": "هذا الجهاز / المتصفح لا يدعم الإشعارات.",
    "Notifications bloquées dans les réglages du navigateur. Autorisez-les puis réessayez.": "الإشعارات محظورة في إعدادات المتصفح. اسمح بها ثم أعد المحاولة.",
    "Notifications activées sur cet appareil.": "الإشعارات مفعّلة على هذا الجهاز.",
    "Activez les notifications pour être alerté (coulages à valider, éprouvettes à écraser…).": "فعّل الإشعارات ليصلك التنبيه (صبّات للاعتماد، عيّنات للاختبار…).",
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
    "Mode de coulage": "طريقة الصبّ",
    "Cochez le mode utilisé sur chantier ; il sera repris dans le bulletin d'échantillonnage.": "حدّد طريقة الصبّ المستعملة في الورشة؛ ستظهر في استمارة أخذ العينات.",
    "Pompe": "مضخة",
    "Benne": "دلو",
    "Autre": "أخرى",
    "Mode de coulage — autre": "طريقة الصبّ — أخرى",
    "Préciser le mode de coulage": "حدّد طريقة الصبّ",
    "Choisissez le mode de coulage : Pompe, Benne ou Autre.": "اختر طريقة الصبّ: مضخة أو دلو أو أخرى.",
    "Précisez le mode de coulage.": "حدّد طريقة الصبّ.",

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
    "Aucun lot dans le bassin. Répartissez d'abord des éprouvettes.": "لا توجد أي مجموعة في الحوض. وزّع العيّنات أولاً.",
    "Aucun lot dans le bassin. Tous les lots sont sortis pour essai (voir ci-dessous).": "لا توجد أي مجموعة في الحوض. كل المجموعات خرجت للاختبار (انظر أدناه).",
    "Tous les lots sont sortis pour essai (voir ci-dessous).": "كل المجموعات خرجت للاختبار (انظر أدناه).",
    "Répartissez d'abord des éprouvettes.": "وزّع العيّنات أولاً.",

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

    // ---- Champs des formulaires (parcours opérateur) ----
    "Client / Entreprise": "الزبون / المؤسسة",
    "ou rechercher par code projet": "أو البحث برمز المشروع",
    "Nom du client / particulier": "اسم الزبون / خاصّ",
    "Lieu / désignation": "المكان / التسمية",
    "Code (racine de la référence)": "الرمز (أصل المرجع)",
    "Modèle enregistré": "نموذج محفوظ",
    "Fournisseur / centrale": "المورّد / المحطة",
    "Fournisseur / centrale béton": "المورّد / محطة الخرسانة",
    "Classe béton": "صنف الخرسانة",
    "Type de ciment": "نوع الإسمنت",
    "Provenance ciment": "مصدر الإسمنت",
    "Dosage ciment (kg/m³)": "جرعة الإسمنت (kg/m³)",
    "Dosage ciment (kg)": "جرعة الإسمنت (kg)",
    "Sable 01 - fraction": "الرمل 01 - الفئة",
    "Sable 01 - quantité (kg/m³)": "الرمل 01 - الكمية (kg/m³)",
    "Sable 01 - quantité (kg)": "الرمل 01 - الكمية (kg)",
    "Provenance sable 01": "مصدر الرمل 01",
    "Sable 02 - fraction": "الرمل 02 - الفئة",
    "Sable 02 - quantité (kg/m³)": "الرمل 02 - الكمية (kg/m³)",
    "Sable 02 - quantité (kg)": "الرمل 02 - الكمية (kg)",
    "Provenance sable 02": "مصدر الرمل 02",
    "Agrégat 3/8 - quantité (kg/m³)": "الحصى 3/8 - الكمية (kg/m³)",
    "3/8 - quantité (kg)": "3/8 - الكمية (kg)",
    "Provenance agrégat 3/8": "مصدر الحصى 3/8",
    "Agrégat 8/15 - quantité (kg/m³)": "الحصى 8/15 - الكمية (kg/m³)",
    "8/15 - quantité (kg)": "8/15 - الكمية (kg)",
    "Provenance agrégat 8/15": "مصدر الحصى 8/15",
    "Agrégat 15/25 - quantité (kg/m³)": "الحصى 15/25 - الكمية (kg/m³)",
    "15/25 - quantité (kg)": "15/25 - الكمية (kg)",
    "Provenance agrégat 15/25": "مصدر الحصى 15/25",
    "Eau (L/m³)": "الماء (L/m³)",
    "Eau (Litre)": "الماء (لتر)",
    "Provenance eau": "مصدر الماء",
    "Adjuvant": "الإضافات",
    "Dosage adjuvant (%)": "جرعة الإضافات (%)",
    "Provenance adjuvant": "مصدر الإضافات",
    "Ciment": "الإسمنت",
    "Sables": "الرمال",
    "Agrégats": "الحصى",
    "Eau et adjuvant": "الماء والإضافات",
    "Provenance 3/8": "مصدر 3/8",
    "Provenance 8/15": "مصدر 8/15",
    "Provenance 15/25": "مصدر 15/25",
    "Observation": "ملاحظة",
    "Observation prélèvement": "ملاحظة أخذ العيّنة",
    "N° camion / toupie": "رقم الشاحنة / الخلّاطة",
    "N° BL": "رقم وصل التسليم",
    "Bloc": "بلوك", "Bloc / zone": "بلوك / المنطقة",
    "Étage": "الطابق", "Partie": "الجزء",
    "Quantité (m³)": "الكمّية (m³)",
    "Affaissement (cm)": "سلامب",
    "Température (°C)": "درجة الحرارة (°C)",
    "Nombre d'éprouvettes": "عدد العيّنات",
    "Quantité évacuée (éprouvettes)": "الكمّية المُجلاة (عيّنات)",
    "Préciser l'ouvrage": "تحديد المنشأ",
    "Proposer cette formulation comme modèle": "اقتراح هذه الصيغة كنموذج",
    "Malaxeur suivant": "الخلّاطة التالية",
    "Terminer le coulage": "إنهاء الصبّ",
    "Commencer le prélèvement": "بدء أخذ العيّنة",
    "ex. 0/1": "مثال 0/1",
    "ex. 0/4": "مثال 0/4",
    "ex. 420": "مثال 420",
    "ex. 350": "مثال 350",
    "ex. 180": "مثال 180",
    "ex. 700": "مثال 700",
    "ex. 300": "مثال 300",
    "ex. 175": "مثال 175",
    "ex. Cimenterie de Chlef": "مثال مصنع إسمنت الشلف",
    "ex. TERGA / TRANS CANAL": "مثال ترقة / ترانس كانال",
    "ex. Carrière": "مثال محجرة",
    "ex. SEOR": "مثال SEOR",
    "ex. SIKA": "مثال SIKA",

    // ---- Écran fiche coulage / récap ----
    "Répertoire des coulages": "سجل الصبّات",
    "Aucune alerte coulage en cours": "لا يوجد تنبيه صبّ حالياً",
    "Ouvrage(s) coulé(s)": "العنصر / العناصر المصبوبة",
    "Choisissez la (les) famille(s), puis touchez les ouvrages concernés.": "اختر العائلة أو العائلات، ثم اضغط على العناصر المعنية.",
    "Autres (ouvrage non listé)": "أخرى (عنصر غير موجود في القائمة)",
    "(à préciser)": "(يُحدّد)",
    "(facultatif)": "(اختياري)",
    "Bloc / Étage / Partie": "بلوك / الطابق / الجزء",
    "Début coulage": "بدء الصبّ",
    "Malaxeurs": "الخلّاطات",
    "Récap": "الملخّص",
    "Récapitulatif": "الملخّص",
    "Prélèvement d'échantillons": "أخذ عيّنات",
    "Avez-vous effectué un prélèvement d'échantillons de béton sur ce malaxeur / toupie ?": "هل تم أخذ عيّنات خرسانة من هذه الخلّاطة / الشاحنة؟",
    "Type de moule — touchez Cube, Cylindre, ou les deux (= prélèvement mixte) :": "نوع القالب: اضغط مكعب أو أسطوانة أو الاثنين (= عيّنة مختلطة):",
    "Cube": "مكعب",
    "Cylindre": "أسطوانة",
    "Mixte": "مختلط",
    "Données du malaxeur / toupie": "بيانات الخلّاطة / الشاحنة",
    "Heure de prélèvement": "وقت أخذ العيّنة",
    "Quantité de béton (m³)": "كمية الخرسانة (m³)",
    "Formulation / Centrale": "الصيغة / المحطة الخرسانة / مكونات الخرسانة",
    "Saisie": "إدخال",
    "Photo BL": "صورة وصل التسليم",
    "Photo du BL / formulation": "صورة وصل التسليم / الصيغة",
    "La photo est compressée et stockée localement.": "يتم ضغط الصورة وتخزينها محلياً.",
    "Annuler le malaxeur": "إلغاء الخلّاطة",
    "Réf. coulage": "مرجع الصبّ",
    "Quantité totale": "الكمية الإجمالية",
    "Total éprouvettes": "إجمالي العيّنات",
    "Détail des malaxeurs": "تفاصيل الخلّاطات",
    "Modifier": "تعديل",
    "Supprimer": "حذف",
    "Ajouter un malaxeur": "إضافة خلّاطة",
    "Prélèvements réalisés": "العينات المنجزة",
    "Les prélèvements sont déclarés pendant la saisie de chaque malaxeur. Codification : RÉF-E1, RÉF-E2…": "يتم التصريح بالعيّنات أثناء إدخال كل خلّاطة. الترميز: RÉF-E1، RÉF-E2…",
    "Aucun prélèvement déclaré. Indiquez-le pendant la saisie d'un malaxeur (question « Avez-vous effectué un prélèvement ? »).": "لم يتم التصريح بأي عيّنة. حدّد ذلك أثناء إدخال الخلّاطة (سؤال: هل تم أخذ عيّنة؟).",
    "Signaler un problème / anomalie": "الإبلاغ عن مشكلة / خلل",
    "Décrire le problème (facultatif)": "وصف المشكلة (اختياري)",
    "Photo de l'anomalie": "صورة الخلل",
    "Enregistrer une note audio": "تسجيل ملاحظة صوتية",
    "Profil : Technicien laboratoire · Annexe Béchar (pré-rempli, modifiable).": "الملف: تقني مخبر · ملحقة بشار (مملوء مسبقاً، قابل للتعديل).",
    "La validation et le partage au bureau se font ensuite depuis le Répertoire des coulages.": "يتم الاعتماد والمشاركة مع المكتب لاحقاً من سجل الصبّات.",
    "Retour à l'accueil": "الرجوع إلى الصفحة الرئيسية",
    "Fiche": "بطاقة",
    "Statut": "الحالة",
    "Référence": "المرجع",
    "Adresse / Ville": "العنوان / المدينة",
    "Code projet": "رمز المشروع",
    "Fondation": "الأساسات",
    "Superstructure": "الهيكل العلوي",
    "Choisissez d'abord une famille ci-dessus.": "اختر أولاً عائلة من الأعلى.",
    "facultatif — coulage en plusieurs reprises": "اختياري - الصبّ على عدة مراحل",
    "Ouvrages": "العناصر",
    "Bloc / Étage": "بلوك / الطابق",

    // ---- Messages généraux ----
    "Aucun coulage en attente de validation.": "لا يوجد صبّ في انتظار الاعتماد.",
    "Aucun résultat en attente.": "لا توجد نتيجة في الانتظار.",
    "Chargement…": "جارٍ التحميل…",

    // ---- Bassin / répartition / déchets / compression ----
    "Aucune alerte bassin en cours": "لا يوجد تنبيه حوض حالياً",
    "Fiches validées comportant des éprouvettes, pas encore réparties au bassin.": "بطاقات معتمدة تحتوي على عيّنات ولم توزّع بعد في الحوض.",
    "Aucune fiche à répartir pour l'instant.": "لا توجد بطاقة للتوزيع حالياً.",
    "Revoir / corriger": "مراجعة / تصحيح",
    "Répartition en": "التوزيع على",
    "lots d'essai": "مجموعات اختبار",
    ". On ne mélange pas deux prélèvements dans un même lot. Par défaut :": ". لا يتم خلط عينتين في نفس المجموعة. افتراضياً:",
    ", le reste à": "، والباقي على",
    ". Vous pouvez changer l'échéance de chaque lot, ou": ". يمكنك تغيير موعد كل مجموعة، أو",
    "✂ Diviser": "✂ تقسيم",
    "un lot pour un âge exigé par le client (ex. 3 j) — le reste garde son échéance.": "مجموعة لعمر يطلبه الزبون (مثلاً 3 أيام) - والباقي يحتفظ بموعده.",
    "prélèvements dans un même lot. Par défaut :": "عيّنات في نفس المجموعة. افتراضياً:",
    "aucun mélange de prélèvements": "بدون خلط العينات",
    "lot(s) d'essai": "مجموعة اختبار",
    "Verrouillée : un lot a déjà été écrasé ou archivé.": "مقفلة: تم اختبار أو أرشفة مجموعة بالفعل.",
    "Couleurs (échéance d'essai) :": "الألوان (موعد الاختبار):",
    "Échéance loin": "الموعد بعيد",
    "J-2 (à sortir bientôt)": "J-2 (للإخراج قريباً)",
    "J-1 (à sortir aujourd'hui)": "J-1 (للإخراج اليوم)",
    "Retard (R)": "تأخير (R)",
    "Sorti pour essai": "أُخرج للاختبار",
    "Formes (type) :": "الأشكال (النوع):",
    "Carré = Cube": "مربع = مكعب",
    "Cercle = Cylindre": "دائرة = أسطوانة",
    "Hexagone = Mixte": "سداسي = مختلط",
    "Lots sortis du bassin — en attente d'essai": "مجموعات خارجة من الحوض في انتظار الاختبار",
    "Ces lots ne sont plus dans le bassin : ils sèchent / sont préparés avant l'essai (délai 24 h conseillé).": "هذه المجموعات لم تعد في الحوض: تجف / يتم تحضيرها قبل الاختبار (ينصح بمدة 24 ساعة).",
    "Ouvrage": "العنصر",
    "Date de coulage": "تاريخ الصبّ",
    "Prélèvement": "العينة",
    "Type": "النوع",
    "Nombre": "العدد",
    "Codification": "الترميز",
    "Âge": "العمر",
    "Date prévue": "التاريخ المتوقع",
    "Statut": "الحالة",
    "Revoir la répartition de ce coulage": "مراجعة توزيع هذا الصبّ",
    "Sortie en retard (échéance d'essai dépassée) : motif obligatoire.": "إخراج متأخر (تم تجاوز موعد الاختبار): السبب إجباري.",
    "Sortie aujourd'hui : conforme à l'échéance.": "إخراج اليوم: مطابق للموعد.",
    "Sortie anticipée : motif obligatoire.": "إخراج مبكر: السبب إجباري.",
    "Éprouvettes cassées après essai de compression. L'historique des essais n'est pas affecté.": "عيّنات مكسّرة بعد اختبار الضغط. سجل الاختبارات لا يتأثر.",
    "éprouvettes cassées": "عيّنات مكسّرة",
    "kg estimés": "كغ تقديري",
    "seuil d'alerte": "حد التنبيه",
    "Confirmer une évacuation": "تأكيد عملية إجلاء",
    "Confirmer évacuation": "تأكيد الإجلاء",
    "Historique des évacuations": "سجل الإجلاءات",
    "Aucune évacuation enregistrée.": "لا توجد عملية إجلاء مسجلة.",
    "Aucun essai en attente": "لا يوجد اختبار في الانتظار",
    "Lots sortis du bassin pour essai. Saisissez les résultats d'écrasement.": "مجموعات خارجة من الحوض للاختبار. أدخل نتائج الضغط.",
    "Aucun lot sorti pour essai. Sortez d'abord des lots depuis le bassin.": "لا توجد مجموعة خارجة للاختبار. أخرج المجموعات أولاً من الحوض.",
    "Historique des essais": "سجل الاختبارات",
    "Du": "من",
    "Au": "إلى",
    "Filtrer": "تصفية",
    "Tout": "الكل",
    "Aucun essai enregistré.": "لا يوجد اختبار مسجل.",

    // ---- Messages dynamiques / confirmations ----
    "Valider le coulage {ref} ?": "هل تريد اعتماد عملية الصبّ {ref}؟",
    "La désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.": "سيتم تأكيد تسمية المنشأ والصيغة، وستصبح البطاقة مقفلة.",
    "Les photos et audios de ce coulage seront supprimés du serveur après validation.": "سيتم حذف صور وتسجيلات هذا الصبّ من الخادم بعد الاعتماد.",
    "Supprimer le Malaxeur {n} ?": "هل تريد حذف الخلّاطة {n}؟",
    "Soumettre la fiche {ref} au laboratoire ?": "هل تريد إرسال البطاقة {ref} إلى المخبر؟",
    "Elle sera verrouillée et envoyée à l'administrateur pour validation.": "سيتم قفلها وإرسالها إلى المسؤول للاعتماد.",
    "La répartition des éprouvettes au bassin reste possible immédiatement.": "يبقى توزيع العيّنات في الحوض ممكناً مباشرة.",
    "Voulez-vous vraiment supprimer la fiche {ref} ? Cette action est irréversible.": "هل تريد فعلاً حذف البطاقة {ref}؟ لا يمكن التراجع عن هذا الإجراء.",
    "Confirmer la sortie pour essai de ce lot ({n} éprouvette(s)) ?": "هل تريد تأكيد إخراج هذه المجموعة للاختبار ({n} عيّنة)؟",
    "Désactiver cet opérateur ? Il ne pourra plus se connecter.": "هل تريد تعطيل هذا المُشغّل؟ لن يستطيع تسجيل الدخول.",
    "Désactiver ce laboratoire ? Il n'apparaîtra plus dans les listes.": "هل تريد تعطيل هذا المخبر؟ لن يظهر في القوائم.",
    "Confirmez-vous que le coulage est bien terminé ?": "هل تؤكد أن عملية الصبّ انتهت؟",

    // ---- Bassin : sortie / motifs / répartition ----
    "Motif": "السبب",
    "Observation": "ملاحظة",
    "Le motif est obligatoire.": "السبب إجباري.",
    "Motif obligatoire.": "السبب إجباري.",
    "Précisez le motif :": "حدّد السبب:",
    "Aucun lot à répartir.": "لا توجد مجموعة للتوزيع.",
    "Âge invalide.": "عمر غير صالح.",
    "Cette répartition ne peut plus être modifiée : un lot a déjà été sorti pour essai, testé ou archivé.": "لم يعد بالإمكان تعديل هذا التوزيع: تم إخراج مجموعة للاختبار أو اختبارها أو أرشفتها.",
    "Enregistrer les corrections de cette répartition ?": "حفظ تصحيحات هذا التوزيع؟",
    "Les lots encore en bassin de ce coulage seront remplacés.": "سيتم استبدال المجموعات التي لا تزال في حوض هذا الصبّ.",
    "Confirmer la répartition des éprouvettes ?": "تأكيد توزيع العيّنات؟",
    "Profil opérateur requis pour sortir un lot du bassin.": "ملف المُشغّل مطلوب لإخراج مجموعة من الحوض.",
    "Profil opérateur requis. Veuillez renseigner votre nom et qualification.": "ملف المُشغّل مطلوب. يرجى إدخال الاسم والوظيفة.",
    // Motifs de sortie (accord) et de retard
    "Accord client": "موافقة الزبون",
    "Accord chef labo": "موافقة رئيس المخبر",
    "Contrainte planning": "قيد في البرنامج",
    "Jour férié": "يوم عطلة",
    "Autre": "أخرى",
    "Presse indisponible": "المكبس غير متوفر",
    "Oubli": "نسيان",
    "Demande client": "طلب الزبون",
    "Jour non ouvrable": "يوم غير عملي",

    // ---- Compression : forçage / passage anticipé ----
    "Forcer le passage maintenant": "فرض المرور الآن",
    "Profil opérateur requis pour forcer le passage avant 24 h.": "ملف المُشغّل مطلوب لفرض المرور قبل 24 ساعة.",
    "Passage anticipé (moins de 24 h hors bassin) — action exceptionnelle.": "مرور مبكر (أقل من 24 ساعة خارج الحوض) — إجراء استثنائي.",
    "Indiquez le motif (numéro ou texte libre) :": "حدّد السبب (رقم أو نص حر):",
    "Le motif est obligatoire pour forcer le passage.": "السبب إجباري لفرض المرور.",
    "Confirmer le passage anticipé de ce lot en « À tester » ?": "تأكيد المرور المبكر لهذه المجموعة إلى «للاختبار»؟",
    "Éprouvette ayant dépassé son séjour": "عيّنة تجاوزت مدة بقائها",
    "Problème machine / presse": "عطل الآلة / المكبس",
    "Contrainte exceptionnelle du laboratoire": "قيد استثنائي بالمخبر",
    "Sortie anticipée (avant l'échéance d'essai) : motif obligatoire.": "إخراج مبكر (قبل موعد الاختبار): السبب إجباري.",

    // ---- Notifications (message d'activation) ----
    "Notifications non configurées sur le serveur. Contactez l'administrateur.": "الإشعارات غير مهيّأة على الخادم. اتصل بالمسؤول.",
    "Permission refusée.": "تم رفض الإذن.",
    "Non supporté sur cet appareil.": "غير مدعوم على هذا الجهاز.",
    "Connectez-vous d'abord.": "سجّل الدخول أولاً.",
    "Enregistrement serveur impossible.": "تعذّر التسجيل على الخادم.",

    // ---- Validation coulage ----
    "Corriger": "تصحيح",
    "Corriger / renvoyer le coulage": "تصحيح / إعادة الصبّ",
    "Renvoyer à l'opérateur": "إعادة إلى المُشغّل",
    "Correction par le vérificateur": "تصحيح من طرف المُدقّق",
    "— modifiez les informations saisies par l'opérateur, puis enregistrez et validez. Les prélèvements et la codification ne sont pas modifiables ici.": "— عدّل المعلومات التي أدخلها المُشغّل ثم احفظ واعتمد. العيّنات والترميز غير قابلة للتعديل هنا.",
    "Enregistrer les corrections et valider": "حفظ التصحيحات والاعتماد",
    "Corrigé par :": "صُحّح من طرف:",
    "(non modifiable)": "(غير قابل للتعديل)",
    "Eau (L/m³)": "الماء (L/m³)",
    "Sable 01 — fraction": "رمل 01 — الحبيبات",
    "Sable 01 (kg/m³)": "رمل 01 (kg/m³)",
    "Sable 02 — fraction": "رمل 02 — الحبيبات",
    "Sable 02 (kg/m³)": "رمل 02 (kg/m³)",
    "Agrégat 3/8 (kg/m³)": "حصى 3/8 (kg/m³)",
    "Agrégat 8/15 (kg/m³)": "حصى 8/15 (kg/m³)",
    "Agrégat 15/25 (kg/m³)": "حصى 15/25 (kg/m³)",
    "Lecture du formulaire impossible.": "تعذّرت قراءة النموذج."
  };

  var MIXED = [
    ["Motif :", "السبب:"],
    ["Nombre invalide", "عدد غير صالح"],
    ["Aucune alerte coulage en cours", "لا يوجد تنبيه صبّ حالياً"],
    ["Aucune alerte bassin en cours", "لا يوجد تنبيه حوض حالياً"],
    ["Aucun essai en attente", "لا يوجد اختبار في الانتظار"],
    ["fiche à valider", "بطاقة للاعتماد"],
    ["fiches à valider", "بطاقات للاعتماد"],
    ["codification non confirmée", "ترميز غير مؤكد"],
    ["à répartir", "للتوزيع"],
    ["à sortir aujourd'hui (J-1)", "للإخراج اليوم (J-1)"],
    ["à sortir aujourd'hui", "للإخراج اليوم"],
    ["bientôt (J-2)", "قريباً (J-2)"],
    ["en retard", "متأخر"],
    ["coulé le", "صُبّ بتاريخ"],
    ["éprouvette(s)", "عيّنة"],
    ["lot(s) à tester", "مجموعة للاختبار"],
    ["fiche(s) à répartir", "بطاقة للتوزيع"],
    ["éprouvettes cassées", "عيّنات مكسّرة"],
    ["kg estimés", "كغ تقديري"],
    ["seuil d'alerte", "حد التنبيه"],
    ["Malaxeur", "خلّاطة"],
    ["Supprimer", "حذف"],
    ["Modifier", "تعديل"],
    ["Quantité totale", "الكمية الإجمالية"],
    ["Total éprouvettes", "إجمالي العيّنات"],
    ["Détail des malaxeurs", "تفاصيل الخلّاطات"],
    ["Réf. coulage", "مرجع الصبّ"],
    ["Code projet", "رمز المشروع"],
    ["Adresse / Ville", "العنوان / المدينة"],
    ["Statut", "الحالة"],
    ["Fiche", "بطاقة"],
    ["Fondation", "الأساسات"],
    ["Superstructure", "الهيكل العلوي"],
    ["Bloc / Étage / Partie", "بلوك / الطابق / الجزء"],
    ["Bloc / étage", "بلوك / الطابق"],
    ["Bloc / Étage", "بلوك / الطابق"],
    ["Ouvrages", "العناصر"],
    ["Totaux", "الإجماليات"],
    ["Formulation / Centrale", "الصيغة / المحطة الخرسانة / مكونات الخرسانة"],
    ["Formulation / BL", "الصيغة / وصل التسليم"],
    ["Bon de livraison", "وصل التسليم"],
    ["Éprouvettes", "العيّنات"],
    ["Anomalie", "خلل"],
    ["Note audio pour l'admin", "ملاحظة صوتية للمسؤول"],
    ["Cube", "مكعب"],
    ["Cylindre", "أسطوانة"],
    ["Mixte", "مختلط"]
  ];

  var RULES = [
    { re: /(\d+)\s+fiche\(s\)\s+à répartir/g, ar: "$1 بطاقة للتوزيع" },
    { re: /(\d+)\s+fiche(s)?\s+à valider/g, ar: "$1 بطاقة للاعتماد" },
    { re: /(\d+)\s+lot\(s\)\s+à tester/g, ar: "$1 مجموعة للاختبار" },
    { re: /(\d+)\s+lot\(s\)\s+d'essai/g, ar: "$1 مجموعة اختبار" },
    { re: /(\d+)\s+éprouvette\(s\)/g, ar: "$1 عيّنة" },
    { re: /(\d+)\s+éprouvette(s)? cassée(s)?/g, ar: "$1 عيّنة مكسّرة" },
    { re: /(\d+)\s+à sortir aujourd'hui/g, ar: "$1 للإخراج اليوم" },
    { re: /(\d+)\s+en retard/g, ar: "$1 متأخر" },
    { re: /(\d+)\s+bientôt \(J-2\)/g, ar: "$1 قريباً (J-2)" },
    { re: /E(\d+)\s+Cube\s+×(\d+)/g, ar: "E$1 مكعب ×$2" },
    { re: /E(\d+)\s+Cylindre\s+×(\d+)/g, ar: "E$1 أسطوانة ×$2" },
    { re: /E(\d+)\s+Mixte\s+×(\d+)/g, ar: "E$1 مختلط ×$2" }
  ];

  function lang() { return _lang; }
  function T(s) {
    if (_lang !== "ar" || s == null) { return s; }
    var k = String(s).trim();
    return AR[k] || _translateMixed(k) || s;
  }
  function F(s, vars) {
    var out = T(s);
    vars = vars || {};
    Object.keys(vars).forEach(function (k) {
      out = String(out).replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    });
    return out;
  }

  // emoji/pictogrammes/flèches de tête (pas les chiffres ni les lettres)
  var LEAD = new RegExp("^([\\u2190-\\u21FF\\u2300-\\u27BF\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}\\uFE0F\\u200D]+\\s*)([\\s\\S]+)$", "u");

  function _translateMixed(t) {
    var out = String(t);
    for (var r = 0; r < RULES.length; r++) { out = out.replace(RULES[r].re, RULES[r].ar); }
    var sorted = MIXED.slice().sort(function (a, b) { return b[0].length - a[0].length; });
    for (var i = 0; i < sorted.length; i++) {
      out = out.split(sorted[i][0]).join(sorted[i][1]);
    }
    return out !== t ? out : "";
  }

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
      return;
    }
    var mixed = _translateMixed(t);
    if (mixed) {
      if (n.__fr == null) { n.__fr = raw; }
      n.nodeValue = raw.replace(t, mixed);
    }
  }

  // Attributs traduits (le texte des <option> l'est comme un nœud texte).
  var I18N_ATTRS = ["placeholder", "title", "aria-label", "alt"];

  function _translateAttrs(root) {
    for (var a = 0; a < I18N_ATTRS.length; a++) {
      var attr = I18N_ATTRS[a];
      var els = root.querySelectorAll ? root.querySelectorAll("[" + attr + "]") : [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = (el.getAttribute(attr) || "").trim();
        if (t && AR[t]) {
          var bak = "data-fr-" + attr;
          if (!el.hasAttribute(bak)) { el.setAttribute(bak, el.getAttribute(attr)); }
          el.setAttribute(attr, AR[t]);
        }
      }
    }
  }

  function _restoreAttrs() {
    for (var a = 0; a < I18N_ATTRS.length; a++) {
      var attr = I18N_ATTRS[a];
      var bak = "data-fr-" + attr;
      var els = document.querySelectorAll("[" + bak + "]");
      for (var i = 0; i < els.length; i++) {
        els[i].setAttribute(attr, els[i].getAttribute(bak));
        els[i].removeAttribute(bak);
      }
    }
  }

  function translate(root) {
    root = root || document.body;
    if (_lang !== "ar") { return; }
    _translating = true;
    // Le texte des <option> est traduit (choix des listes déroulantes) ; seuls
    // SCRIPT/STYLE/TEXTAREA sont exclus. Les valeurs dynamiques (noms de client,
    // projets…) ne sont pas dans le dictionnaire -> restent inchangées.
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode;
        if (!p) { return NodeFilter.FILTER_REJECT; }
        var tag = p.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") { return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (w.nextNode()) { nodes.push(w.currentNode); }
    nodes.forEach(_translateNode);
    _translateAttrs(root);
    _translating = false;
  }

  function _restoreAll() {
    _translating = true;
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (w.nextNode()) { nodes.push(w.currentNode); }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.__fr != null) { n.nodeValue = n.__fr; n.__fr = null; }
    }
    _restoreAttrs();
    _translating = false;
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
      if (_translating) { return; }
      if (_lang !== "ar") { return; }
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].type === "characterData") {
          _translateNode(muts[i].target);
        } else if (muts[i].type === "attributes") {
          _translateAttrs(muts[i].target.parentNode || document.body);
        } else {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType === 1) { translate(node); }
            else if (node.nodeType === 3) { _translateNode(node); }
          }
        }
      }
    });
    _obs.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: I18N_ATTRS
    });
  }

  function init() {
    _bindToggles();
    _observe();
    setLang(_lang);
    // Les consignes opérateur passent souvent par alert/confirm/prompt :
    // on traduit leur message (ligne par ligne).
    function trMsg(m) {
      return String(m).split("\n").map(function (line) { return T(line); }).join("\n");
    }
    var _alert = window.alert.bind(window);
    window.alert = function (m) { return _alert(trMsg(m)); };
    var _confirm = window.confirm.bind(window);
    window.confirm = function (m) { return _confirm(trMsg(m)); };
    var _prompt = window.prompt.bind(window);
    window.prompt = function (m, d) { return _prompt(m == null ? m : trMsg(m), d); };
  }

  return { init: init, setLang: setLang, lang: lang, T: T, f: F, translate: translate };
})();

document.addEventListener("DOMContentLoaded", function () { I18N.init(); });
