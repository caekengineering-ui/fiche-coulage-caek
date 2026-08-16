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
    "Validation": "الاعتماد",
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
    "Administrateur — Responsable labo": "مسؤول — مسؤول المخبر",
    "Responsable labo": "مسؤول المخبر",

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
    "Autres": "أخرى",
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
    "Fournisseur / centrale": "الصيغة / محطة الخرسانة / مكونات الخرسانة",
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
    "Formulation / Centrale": "الصيغة / محطة الخرسانة / مكونات الخرسانة",
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
    "✓ Bassin à jour": "✓ الحوض محدَّث",
    "⚠ Bassin non synchronisé — dernière mise à jour :": "⚠ الحوض غير متزامن — آخر تحديث:",
    "⚠ Bassin jamais synchronisé avec le serveur": "⚠ الحوض لم تتم مزامنته مع الخادم قط",
    "⏳ Synchronisation du bassin…": "⏳ جارٍ مزامنة الحوض…",
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
    "Les photos et audios restent en ligne jusqu'à leur archivage par le bureau.": "تبقى الصور والتسجيلات متاحة على الخادم إلى حين أرشفتها من طرف المكتب.",
    "Prendre la version serveur": "اعتماد نسخة الخادم",
    "Garder mes modifications et renvoyer": "الاحتفاظ بتعديلاتي وإعادة الإرسال",
    "Prendre la version serveur ?": "هل تريد اعتماد نسخة الخادم؟",
    "Vos modifications locales non synchronisées seront abandonnées.": "سيتم التخلي عن تعديلاتك المحلية غير المتزامنة.",
    "Garder vos modifications et les renvoyer au serveur ?": "هل تريد الاحتفاظ بتعديلاتك وإعادة إرسالها إلى الخادم؟",
    "Elles remplaceront la version serveur actuelle.": "ستحل محل نسخة الخادم الحالية.",
    "Provisoire": "مؤقت",
    "Conflit de versions : la fiche a été modifiée ailleurs. Consultez le Répertoire pour résoudre.": "تعارض في الإصدارات: عُدّلت البطاقة في مكان آخر. راجع الفهرس لحل التعارض.",
    "La référence officielle sera attribuée automatiquement à la synchronisation.": "سيتم إسناد المرجع الرسمي تلقائياً عند المزامنة.",

    // ---- Phase 2 : métier ----
    "Centrale & formulation": "المحطة والصيغة",
    "Centrale (fournisseur du béton)": "المحطة (مورّد الخرسانة)",
    "Préciser la centrale": "حدّد المحطة",
    "Formulation (modèle validé)": "الصيغة (نموذج معتمد)",
    "— Choisir un modèle —": "— اختر نموذجاً —",
    "Formulation inconnue ? Détaillez-la dans le premier malaxeur puis « Proposer cette formulation comme modèle » : elle sera validée par le laboratoire.": "صيغة غير معروفة؟ فصّلها في الخلّاطة الأولى ثم « اقترح هذه الصيغة كنموذج »: سيعتمدها المخبر.",
    "Quantité estimée (m³)": "الكمية المقدَّرة (م³)",
    "Quantité validée (m³)": "الكمية المعتمدة (م³)",
    "Désignation officielle de l'ouvrage (documents)": "التسمية الرسمية للمنشأ (الوثائق)",
    "Observation générale du malaxeur": "ملاحظة عامة عن الخلّاطة",
    "État du coulage à la fin de mon intervention": "حالة الصبّ عند نهاية تدخلي",
    "Fin de mon intervention": "نهاية تدخلي",
    "Terminé": "منتهٍ",
    "En cours": "جارٍ",
    "Inconnu": "غير معروف",
    "Fin de votre intervention — le coulage est TERMINÉ. Confirmer ?": "نهاية تدخلك — الصبّ منتهٍ. تأكيد؟",
    "Fin de votre intervention — le coulage CONTINUE sans vous. Confirmer ?": "نهاية تدخلك — الصبّ مستمر بدونك. تأكيد؟",
    "Fin de votre intervention — état du coulage INCONNU. Confirmer ?": "نهاية تدخلك — حالة الصبّ غير معروفة. تأكيد؟",
    "Dupliquer les informations": "نسخ المعلومات",
    "Créer une nouvelle fiche pré-remplie depuis {ref} ?": "هل تريد إنشاء بطاقة جديدة معبّأة مسبقاً من {ref}؟",
    "Les malaxeurs, prélèvements, résultats, médias et validations ne sont PAS copiés.": "لا يتم نسخ الخلّاطات ولا العينات ولا النتائج ولا الوسائط ولا الاعتمادات.",
    "Duplication impossible.": "تعذّر النسخ.",
    // ---- Phase 5 : sécurisation métier ----
    "Créer une fiche similaire": "إنشاء بطاقة مماثلة",
    "Créer une fiche similaire depuis": "إنشاء بطاقة مماثلة انطلاقاً من",
    "Autres actions": "إجراءات أخرى",
    "Fiche similaire": "بطاقة مماثلة",
    "Incomplète": "غير مكتملة",
    "Reprendre la saisie": "استئناف الإدخال",
    "Cette fiche est incomplète. Reprenez la saisie et terminez votre intervention avant de la soumettre.": "هذه البطاقة غير مكتملة. استأنف الإدخال وأنهِ تدخلك قبل إرسالها.",
    "Seront copiés : client, projet, ouvrage, centrale et formulation.": "سيتم نسخ: الزبون والمشروع والمنشأ والمحطة والصيغة.",
    "Ne seront PAS copiés : date, malaxeurs, prélèvements, résultats, médias et validations.": "لن يتم نسخ التاريخ أو الخلاطات أو العينات أو النتائج أو الوسائط أو الاعتمادات.",
    "La nouvelle fiche restera un brouillon supprimable jusqu'à sa soumission.": "ستبقى البطاقة الجديدة مسودة قابلة للحذف حتى إرسالها.",
    "Interrompre la saisie": "إيقاف الإدخال مؤقتاً",
    "Interrompre la saisie ?": "هل تريد إيقاف الإدخال مؤقتاً؟",
    "La fiche restera INCOMPLÈTE dans le Répertoire.": "ستبقى البطاقة غير مكتملة في السجل.",
    "Elle ne sera pas soumise au laboratoire et vous pourrez la reprendre à tout moment.": "لن تُرسل إلى المخبر ويمكنك استئنافها في أي وقت.",
    "Enregistrer et ajouter le malaxeur suivant": "حفظ وإضافة الخلاطة التالية",
    "Pour quitter le chantier, choisissez uniquement l'une des deux actions ci-dessous.": "لمغادرة الورشة اختر أحد الإجراءين أدناه فقط.",
    "Avez-vous assisté à la totalité du coulage et contrôlé tous les malaxeurs ?": "هل حضرت كامل عملية الصب وراقبت جميع الخلاطات؟",
    "Aucune réponse n'est présélectionnée. « Non » signifie que le coulage a continué après votre départ.": "لا توجد إجابة محددة مسبقاً. «لا» تعني أن الصب استمر بعد مغادرتك.",
    "Oui, j'ai assisté à tout le coulage": "نعم، حضرت كامل عملية الصب",
    "Non, le coulage a continué sans moi": "لا، استمر الصب بدوني",
    "Interruption non enregistrée :": "لم يتم حفظ التوقف:",
    "Recommandation du laboratoire :": "توصية المخبر:",
    "Nombre d'éprouvettes recommandé :": "عدد العيّنات الموصى به:",
    "Recommandation laboratoire": "توصية المخبر",
    "reste recommandé :": "المتبقي الموصى به:",
    "éprouvettes": "عيّنات",
    "Le laboratoire recommande": "يوصي المخبر بـ",
    "éprouvettes pour cette quantité, mais": "عيّنات لهذه الكمية، لكن",
    "seulement ont été enregistrées.": "تم تسجيلها فقط.",
    "Continuer quand même vers la confirmation de soumission ?": "هل تريد المتابعة إلى تأكيد الإرسال؟",
    "Poids moyen d'une éprouvette (kg)": "متوسط وزن العيّنة (كغ)",
    "Règle de recommandation des éprouvettes": "قاعدة التوصية بعدد العيّنات",
    "Première tranche (m³)": "الشريحة الأولى (م³)",
    "Éprouvettes première tranche": "عيّنات الشريحة الأولى",
    "Tranche suivante (m³)": "الشريحة التالية (م³)",
    "Éprouvettes par tranche suivante": "العيّنات لكل شريحة تالية",
    "Chargement du stock serveur…": "جارٍ تحميل مخزون الخادم…",
    "Synchronisé avec le serveur": "متزامن مع الخادم",
    "Choisissez d'abord un laboratoire dans le filtre.": "اختر مخبراً أولاً من المرشح.",
    "Choisissez un laboratoire dans le filtre pour afficher son stock.": "اختر مخبراً من المرشح لعرض مخزونه.",
    "Le seuil et le poids moyen doivent être supérieurs à 0.": "يجب أن يكون الحد ومتوسط الوزن أكبر من صفر.",
    "Réseau requis pour modifier les paramètres du laboratoire.": "الشبكة مطلوبة لتعديل إعدادات المخبر.",
    "Paramètres non enregistrés sur le serveur.": "لم تُحفظ الإعدادات على الخادم.",
    "Paramètres synchronisés avec le serveur.": "تمت مزامنة الإعدادات مع الخادم.",
    "Évacuation synchronisée avec le serveur.": "تمت مزامنة الإجلاء مع الخادم.",
    "Évacuation enregistrée hors ligne et en attente de synchronisation.": "تم تسجيل الإجلاء دون اتصال وهو في انتظار المزامنة.",
    "Date de coulage corrigée après engagement — révision des âges requise": "تم تصحيح تاريخ الصب بعد بدء الإجراء — مراجعة الأعمار مطلوبة",
    "Date de coulage corrigée après sortie : vérifiez l'âge réel avant validation.": "تم تصحيح تاريخ الصب بعد الإخراج: تحقق من العمر الفعلي قبل الاعتماد.",
    "Demander confirmation au client": "طلب تأكيد الزبون",
    "Informations provisoires uniquement.": "معلومات مؤقتة فقط.",
    "Aucun résultat d'essai, média ou commentaire interne ne sera partagé.": "لن تتم مشاركة أي نتيجة اختبار أو وسيط أو تعليق داخلي.",
    "Aucune demande envoyée": "لم يُرسل أي طلب",
    "Demande partagée": "تمت مشاركة الطلب",
    "Confirmé par le client": "أكده الزبون",
    "Correction demandée par le client": "طلب الزبون تصحيحاً",
    "Marquer confirmé par le client": "وضع علامة: أكده الزبون",
    "Le client demande une correction": "الزبون يطلب تصحيحاً",
    "Partager uniquement les informations affichées avec le client ?": "مشاركة المعلومات المعروضة فقط مع الزبون؟",
    "Confirmer que le client a explicitement validé ces informations ?": "هل تؤكد أن الزبون وافق صراحة على هذه المعلومات؟",
    "Confirmer que le client a demandé une correction ?": "هل تؤكد أن الزبون طلب تصحيحاً؟",
    "Correction demandée par le client :": "التصحيح الذي طلبه الزبون:",
    "État de confirmation client enregistré.": "تم تسجيل حالة تأكيد الزبون.",
    "État non enregistré.": "لم تُسجل الحالة.",
    "Partage initié et tracé. La réponse du client doit encore être enregistrée.": "بدأت المشاركة وتم تسجيلها. لا يزال يجب تسجيل رد الزبون.",
    "Partage initié, mais sa traçabilité serveur a échoué.": "بدأت المشاركة لكن تعذر تسجيلها على الخادم.",
    "Partage non enregistré :": "لم تُسجل المشاركة:",
    "Motif de la correction de la date de coulage (obligatoire et tracé) :": "سبب تصحيح تاريخ الصب (إجباري ومسجل):",
    "Le motif de correction de la date est obligatoire.": "سبب تصحيح التاريخ إجباري.",
    "La nouvelle date de coulage est invalide.": "تاريخ الصب الجديد غير صالح.",
    "Au moins un lot est déjà sorti ou testé.": "تم إخراج أو اختبار مجموعة واحدة على الأقل.",
    "Appliquer quand même la date corrigée avec cette traçabilité ?": "هل تريد تطبيق التاريخ المصحح مع هذا التتبع؟",
    "Correction contrôlée refusée.": "تم رفض التصحيح المراقب.",
    "Coulage validé et date corrigée avec traçabilité :": "تم اعتماد الصب وتصحيح التاريخ مع التتبع:",
    "Les lots encore dans le bassin seront replanifiés. Les lots déjà engagés garderont leur échéance historique et seront signalés pour révision des âges/résultats.": "ستتم إعادة جدولة المجموعات الموجودة في الحوض. وستحتفظ المجموعات التي بدأ العمل عليها بموعدها التاريخي وتُعلَّم لمراجعة الأعمار والنتائج.",
    "La date ne peut pas être corrigée silencieusement : au moins un lot est déjà sorti ou testé. Renvoyez le dossier pour un traitement contrôlé.": "لا يمكن تصحيح التاريخ بصمت: تم إخراج أو اختبار مجموعة واحدة على الأقل. أعد الملف لمعالجة مراقبة.",
    "Bonjour, merci de confirmer les informations provisoires du coulage :": "مرحباً، يرجى تأكيد المعلومات المؤقتة لعملية الصب:",
    "Étage :": "الطابق:",
    "Fournisseur du béton :": "مورّد الخرسانة:",
    "Quantité de béton :": "كمية الخرسانة:",
    "Merci de répondre « Je confirme » ou d'indiquer les corrections nécessaires.": "يرجى الرد «أؤكد» أو ذكر التصحيحات اللازمة.",
    "Copier le message de confirmation :": "انسخ رسالة التأكيد:",
    "Confirmation provisoire du coulage": "تأكيد مؤقت لعملية الصب",
    "Rôle métier (révision des résultats)": "الدور المهني (مراجعة النتائج)",
    "— Automatique (selon le rôle) —": "— تلقائي (حسب الدور) —",
    "Ingénieur": "مهندس",
    "Responsable": "مسؤول",
    "Admin principal": "المسؤول الرئيسي",
    "Confirmer la sortie pour essai de ce lot (": "تأكيد إخراج هذه المجموعة للاختبار (",
    "un lot pour un âge exigé par le client (ex. 3 j) —": "مجموعة لعمر يطلبه الزبون (مثلاً 3 أيام) —",
    "· ✓ synchronisé": "· ✓ متزامن",
    "est qu": "هو أن",
    "Laboratoires vérifiés (administrateur — aucun coché = tous les labos = admin principal)": "المخابر المعتمدة (مسؤول — عدم تحديد أي مخبر يعني كل المخابر = المسؤول الرئيسي)",
    "🔒 Écran réservé à l'administrateur principal.": "🔒 شاشة مخصصة للمسؤول الرئيسي.",
    "(menu « Ouvrir dans le navigateur / Chrome »), puis installez-la sur l'écran d'accueil et réessayez.": "(قائمة «فتح في المتصفح / Chrome»)، ثم ثبّتها على الشاشة الرئيسية وأعد المحاولة.",
    "Activation impossible pour le moment. Réessayez dans un instant.": "يتعذر التفعيل حالياً. أعد المحاولة بعد قليل.",
    "activées": "مفعّلة",
    "Enregistrement serveur impossible. Vérifiez votre connexion puis réessayez.": "تعذر التسجيل على الخادم. تحقق من الاتصال ثم أعد المحاولة.",
    "Impossible de joindre le service de notifications. Ouvrez l'app dans Chrome (pas dans Facebook), vérifiez votre connexion, puis réessayez.": "تعذر الاتصال بخدمة الإشعارات. افتح التطبيق في Chrome (وليس داخل Facebook)، وتحقق من الاتصال ثم أعد المحاولة.",
    "Les notifications ne fonctionnent pas dans le navigateur de Facebook. Ouvrez l'application dans": "لا تعمل الإشعارات داخل متصفح Facebook. افتح التطبيق في",
    "Ouvrez l'application dans Chrome (menu ⋮ → « Ouvrir dans le navigateur »), pas dans Facebook, puis réessayez.": "افتح التطبيق في Chrome (القائمة ⋮ ← «فتح في المتصفح»)، وليس داخل Facebook، ثم أعد المحاولة.",
    "Permission refusée. Autorisez les notifications dans les réglages du navigateur puis réessayez.": "تم رفض الإذن. اسمح بالإشعارات من إعدادات المتصفح ثم أعد المحاولة.",
    "Sur iPhone : ajoutez d'abord l'app à l'écran d'accueil (Partager « Sur l'écran d'accueil »), puis rouvrez-la pour activer les notifications.": "على iPhone: أضف التطبيق أولاً إلى الشاشة الرئيسية (مشاركة ← «إضافة إلى الشاشة الرئيسية»)، ثم افتحه مجدداً لتفعيل الإشعارات.",
    "béchar": "بشار",
    "Béchar": "بشار",
    "Les médias restent en ligne (archivage bureau).": "تبقى الوسائط على الخادم (أرشفة المكتب).",
    "lot(s) du bassin replanifié(s).": "مجموعة من الحوض أُعيدت جدولتها.",
    "lot(s) engagé(s) signalé(s) pour révision.": "مجموعة بدأ العمل عليها وُسِمت للمراجعة.",
    "lot(s) replanifié(s),": "مجموعة أُعيدت جدولتها،",
    "Échec de la révision (": "فشلت المراجعة (",
    "État :": "الحالة:",

    // ---- Phase 3 : révision / synchronisation ----
    "Réviser les éprouvettes": "مراجعة العيّنات",
    "Aucun essai à réviser.": "لا يوجد اختبار للمراجعة.",

    // ---- Validation des résultats : fiche détaillée + corrections groupées ----
    "Etage": "الطابق",
    "Ouvrage coulé": "المنشأ المصبوب",
    "Ouvrage coulé :": "المنشأ المصبوب:",
    "Ouvrage(s) saisi(s) :": "المنشأ (المنشآت) المُدخلة:",
    "Client :": "الزبون:",
    "Projet :": "المشروع:",
    "Date de l'essai": "تاريخ الاختبار",
    "Date de l'essai :": "تاريخ الاختبار:",
    "Échéance prévue": "الموعد المقرر",
    "Échéance prévue :": "الموعد المقرر:",
    "Éprouvettes :": "العيّنات:",
    "Codification échantillon": "ترميز العيّنة",
    "Codification échantillon :": "ترميز العيّنة:",
    "Écrasé par :": "اختبره:",
    "Laboratoire :": "المخبر:",
    "Essai hors date prévue": "اختبار خارج الموعد المقرر",
    "Ils seront figés et transmis au bureau pour les PV.": "ستُقفل وتُرسل إلى المكتب لإعداد المحاضر.",
    "Résultats validés et transmis au bureau.": "تم اعتماد النتائج وإرسالها إلى المكتب.",
    "Correction des résultats": "تصحيح النتائج",
    "— modifiez les valeurs voulues, puis appuyez sur": "— عدّل القيم المطلوبة، ثم اضغط على",
    "en bas. Chaque modification est tracée (auteur, rôle, motif, ancien/nouveau).": "في الأسفل. كل تعديل يُسجَّل (المُحرِّر، الدور، السبب، القيمة السابقة/الجديدة).",
    "Appliquer les corrections": "تطبيق التصحيحات",
    "Appliquer les corrections sur": "تطبيق التصحيحات على",
    "Les anciennes valeurs restent tracées.": "تبقى القيم السابقة مسجَّلة.",
    "Aucune modification à appliquer.": "لا يوجد تعديل للتطبيق.",
    "Motif des corrections (obligatoire, tracé) :": "سبب التصحيحات (إجباري، مسجَّل):",
    "Les données ont été modifiées :": "تم تعديل البيانات:",
    "éprouvette(s) corrigée(s) et enregistrée(s).": "عيّنة تم تصحيحها وحفظها.",
    "éprouvette(s) déjà corrigée(s))": "عيّنة تم تصحيحها من قبل)",

    // ---- Historique des essais : filtre par code projet ----
    "Code projet (ex. ECPM)": "رمز المشروع (مثال: ECPM)",
    "Aucun essai pour ce code de projet sur la période sélectionnée.": "لا يوجد اختبار لرمز المشروع هذا في الفترة المحددة.",
    "Recalculer Rc": "إعادة حساب Rc",
    "Signaler une incohérence": "الإبلاغ عن تعارض",
    "Note interne": "ملاحظة داخلية",
    "Retourner": "إرجاع",
    "Valider (ingénieur)": "اعتماد (مهندس)",
    "Approuver (responsable)": "موافقة (مسؤول)",
    "Motif de la correction (obligatoire, tracé) :": "سبب التصحيح (إجباري، مسجَّل):",
    "Décrire l'incohérence :": "صف التعارض:",
    "Motif du retour (visible par l'opérateur) :": "سبب الإرجاع (يراه المشغّل):",
    "Note interne (jamais imprimée sur les documents) :": "ملاحظة داخلية (لا تُطبع على الوثائق أبداً):",
    "Le motif est obligatoire.": "السبب إجباري.",
    "Rôle insuffisant pour cette action.": "الدور غير كافٍ لهذا الإجراء.",
    "Lot approuvé par le responsable : verrouillé.": "المجموعة معتمدة من المسؤول: مقفلة.",
    "Lot validé : révision réservée à l'ingénieur ou plus.": "المجموعة معتمدة: المراجعة للمهندس فما فوق.",
    "Synchronisation": "المزامنة",
    "Synchronisé": "متزامن",
    "En attente de synchronisation": "في انتظار المزامنة",
    "Conflit": "تعارض",
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
    "Règle d'or : les éprouvettes d'un même coulage et d'une même": "القاعدة الذهبية: عيّنات الصبّة نفسها ذات",
    "échéance forment": "موعد الاختبار نفسه تشكّل",
    "un seul lot et un seul PV": "مجموعة واحدة ومحضر PV واحد",
    "prélèvements d'origine restent traçables. Par défaut :": "وتبقى العينات الأصلية قابلة للتتبع. افتراضياً:",
    "Regrouper les lots de même échéance": "تجميع المجموعات ذات موعد الاختبار نفسه",
    "lot(s) d'essai — un seul lot par échéance.": "مجموعة اختبار واحدة لكل موعد.",
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
    "Lecture du formulaire impossible.": "تعذّرت قراءة النموذج.",

    // ---- Formulation (choix photo / saisie) ----
    "Photo formulation": "صورة الصيغة",
    "Saisie formulation": "إدخال الصيغة",
    "Choisissez : photographier la formulation (BL) ou la saisir (manuellement ou depuis un modèle enregistré).": "اختر: تصوير الصيغة (وصل التسليم) أو إدخالها (يدويًا أو من نموذج محفوظ).",
    "Prendre une photo": "التقاط صورة",
    "Choisir dans la galerie": "اختيار من المعرض",

    // ---- Bassin : séchage + passage forcé ----
    "En séchage hors bassin": "قيد التجفيف خارج الحوض",
    "Disponible pour essai": "متاح للاختبار",
    "aujourd'hui à 8 h": "اليوم على الساعة 8",
    "demain à 8 h": "غداً على الساعة 8",
    "Passage anticipé (avant le lendemain 8 h) — action exceptionnelle.":
      "تمرير مبكر (قبل الغد على الساعة 8) — إجراء استثنائي.",
    "Profil opérateur requis pour forcer le passage avant séchage complet.":
      "ملف المشغّل مطلوب لفرض التمرير قبل اكتمال التجفيف.",
    "Résultats du lot": "نتائج الدفعة",
    "Cubique": "مكعبية",
    "Cylindrique": "أسطوانية",
    "Moyenne": "المعدل",
    "Minimum": "الأدنى",
    "Maximum": "الأقصى",
    "éprouvettes déjà cylindriques": "عيّنات أسطوانية أصلاً",
    "Partager les résultats": "مشاركة النتائج",
    "Exporter (Excel)": "تصدير (إكسل)",
    "Passage forcé à la machine": "مرور قسري إلى الآلة",
    "Passage forcé": "مرور قسري",
    "Motif obligatoire.": "السبب إجباري.",
    "Saisie de l'essai dans le module « Test de compression ».": "إدخال الاختبار في وحدة «اختبار الضغط».",
    "Aucun lot sorti pour essai. Sortez d'abord des lots depuis le bassin.": "لا توجد مجموعة خارجة للاختبار. أخرج المجموعات من الحوض أولاً.",

    // ---- Correction : formulation depuis un modèle ----
    "Choisir une formulation enregistrée": "اختيار صيغة محفوظة",
    "Enregistrer cette formulation comme modèle": "حفظ هذه الصيغة كنموذج",
    "Renseignez d'abord le fournisseur / la centrale.": "أدخل أولاً المورّد / المحطة.",
    "Échec de l'enregistrement du modèle.": "فشل حفظ النموذج.",
    "— Choisir un modèle (facultatif) —": "— اختر نموذجًا (اختياري) —",

    // ================== PASSE COMPLÈTE 07/2026 ==================
    // ---- Ouvrages (familles + éléments, boutons illustrés) ----
    "Fondation": "الأساسات",
    "Superstructure": "الهيكل العلوي",
    "Semelle isolée": "قاعدة منعزلة",
    "Semelle filante": "قاعدة شريطية",
    "Radier": "لبشة (راديي)",
    "Longrine / libage": "لونجرين / ليباج",
    "Pieu": "خازوق",
    "Plot": "بلوت",
    "Mur de soutènement": "جدار استنادي",
    "Ouvrage enterré": "منشأ مدفون",
    "Regard": "غرفة تفتيش",
    "Piscine": "مسبح",
    "Poteau": "عمود",
    "Voile": "جدار خرساني (فوال)",
    "Dalle": "بلاطة",
    "Poutre": "جائز (رافدة)",
    "Escalier": "درج",
    "Console / Balcon": "كابولي / شرفة",
    "Parapet / Acrotère": "حاجز علوي / أكروتير",
    "Cuve / Bâche à eau": "خزان ماء",
    "Choisissez d'abord une famille ci-dessus.": "اختر أولاً عائلة من الأعلى.",

    // ---- Étages (liste déroulante) ----
    "— Aucun —": "— لا شيء —",
    "4e sous-sol": "الطابق السفلي 4",
    "3e sous-sol": "الطابق السفلي 3",
    "2e sous-sol": "الطابق السفلي 2",
    "1er sous-sol": "الطابق السفلي 1",
    "RDC": "الطابق الأرضي",
    "Mezzanine 1": "ميزانين 1",
    "Mezzanine 2": "ميزانين 2",
    "1er étage": "الطابق 1",
    "2e étage": "الطابق 2",
    "3e étage": "الطابق 3",
    "4e étage": "الطابق 4",
    "5e étage": "الطابق 5",
    "6e étage": "الطابق 6",
    "7e étage": "الطابق 7",
    "8e étage": "الطابق 8",
    "9e étage": "الطابق 9",
    "10e étage": "الطابق 10",
    "11e étage": "الطابق 11",
    "12e étage": "الطابق 12",
    "13e étage": "الطابق 13",
    "14e étage": "الطابق 14",
    "15e étage": "الطابق 15",
    "Buanderie": "غرفة الغسيل",

    // ---- Fiche coulage (étapes, malaxeur, audio, récap) ----
    "Annuler ce malaxeur": "إلغاء هذه الخلّاطة",
    "Supprimer le Malaxeur": "حذف الخلّاطة",
    "Idem précédent": "نفس السابقة",
    "Même formulation / centrale que le malaxeur précédent ?": "نفس الصيغة / المحطة مثل الخلّاطة السابقة؟",
    "Type de moule — touchez": "نوع القالب — المس",
    ", ou les deux (= prélèvement mixte) :": "، أو كليهما (= عيّنة مختلطة):",
    "Nombre total d'éprouvettes prélevées": "العدد الإجمالي للعيّنات المأخوذة",
    "Indiquez le nombre total d'éprouvettes prélevées.": "أدخل العدد الإجمالي للعيّنات المأخوذة.",
    "Sélectionnez le type de moule (cube et/ou cylindre).": "اختر نوع القالب (مكعب و/أو أسطوانة).",
    "Aucun malaxeur saisi.": "لم تُدخل أي خلّاطة.",
    "Ajoutez au moins un malaxeur (quantité de béton) avant de soumettre la fiche.": "أضف خلّاطة واحدة على الأقل (كمية الخرسانة) قبل إرسال البطاقة.",
    "Sélection :": "الاختيار:",
    "Signée par :": "موقّعة من:",
    "Tél :": "الهاتف:",
    "Modifications non enregistrées": "تعديلات غير محفوظة",
    "Brouillon enregistré": "تم حفظ المسودّة",
    "(pré-rempli, modifiable).": "(مُعبّأ مسبقًا، قابل للتعديل).",
    "Pré-rempli depuis le profil opérateur (modifiable).": "مُعبّأ مسبقًا من ملف المُشغّل (قابل للتعديل).",
    "Astuce : renseignez votre profil pour pré-remplir ce champ.": "نصيحة: عبّئ ملفك ليُملأ هذا الحقل مسبقًا.",
    "Nom de l'opérateur (signature interne)": "اسم المُشغّل (توقيع داخلي)",
    "Progression de la fiche": "تقدّم البطاقة",
    "Début du coulage": "بداية الصبّ",
    "Enregistrer une note audio": "تسجيل ملاحظة صوتية",
    "Supprimer cette note audio ?": "حذف هذه الملاحظة الصوتية؟",
    "L'enregistrement audio n'est pas disponible sur cet appareil/navigateur.": "التسجيل الصوتي غير متوفر على هذا الجهاز/المتصفح.",
    "Autorisez l'accès au micro.": "اسمح بالوصول إلى الميكروفون.",
    "Supprimer cette photo ?": "حذف هذه الصورة؟",
    "Aucune photo pour cette fiche.": "لا توجد صورة لهذه البطاقة.",
    "Lecture du fichier impossible.": "تعذّرت قراءة الملف.",
    "Préciser la classe": "حدّد الفئة",
    "Préciser le ciment": "حدّد الإسمنت",
    "Préciser le dosage": "حدّد الجرعة",
    "Préciser le Dmax": "حدّد Dmax",
    "Préciser l'adjuvant": "حدّد المضاف",
    "Entraîneur d'air": "مُدخل الهواء",
    "Superplastifiant": "ملدّن فائق",
    "Hydrofuge": "مانع تسرب الماء",

    // ---- Nouveau coulage ----
    "Choisissez un projet, saisissez un code, ou renseignez un client simple.": "اختر مشروعًا، أو أدخل رمزًا، أو عبّئ زبونًا بسيطًا.",
    "Numéro de coulage invalide.": "رقم الصبّ غير صالح.",
    "Renseignez le nom du client / particulier.": "أدخل اسم الزبون / الخاص.",
    "Brouillon créé :": "أُنشئت المسودّة:",
    "existe déjà. Changez le numéro.": "موجودة من قبل. غيّر الرقم.",
    "La référence": "المرجع",

    // ---- Répertoire (récupération, message, suppression) ----
    "Soumettre la fiche": "إرسال البطاقة",
    "au laboratoire ?": "إلى المخبر؟",
    "Profil opérateur requis. Connectez-vous.": "ملف المُشغّل مطلوب. سجّل الدخول.",
    "Profil opérateur requis pour confirmer la récupération des éprouvettes.": "ملف المُشغّل مطلوب لتأكيد استرجاع العيّنات.",
    "Échec de la soumission.": "فشل الإرسال.",
    "Fiche soumise (hors-ligne) : elle sera transmise au serveur au retour du réseau.": "أُرسلت البطاقة (دون اتصال): ستُنقل إلى الخادم عند عودة الشبكة.",
    "Récupération confirmée. Le coulage peut être réparti au bassin.": "تم تأكيد الاسترجاع. يمكن توزيع الصبّ في الحوض.",
    "Renvoyé par l'administrateur :": "أُعيدت من المسؤول:",
    "Suppression impossible côté serveur.": "تعذّر الحذف من جهة الخادم.",
    "Voulez-vous vraiment supprimer la fiche": "هل تريد فعلاً حذف البطاقة",
    "? Cette action est irréversible.": "؟ هذا الإجراء لا رجعة فيه.",
    "Copier le message :": "انسخ الرسالة:",
    "Message partagé.": "تمت مشاركة الرسالة.",
    "Message récap copié.": "نُسخت الرسالة الموجزة.",
    "Coulage du jour": "صبّ اليوم",
    "1 jour depuis le coulage": "يوم واحد منذ الصبّ",
    "ÉTIQUETTES À INSCRIRE SUR LES ÉPROUVETTES": "بطاقات تُكتب على العيّنات",
    "Récupération des éprouvettes —": "استرجاع العيّنات —",
    "au total": "في المجموع",
    "Les éprouvettes ont été récupérées du chantier.": "تم استرجاع العيّنات من الورشة.",
    "La codification ci-dessus a été vérifiée et confirmée.": "تم التحقق من الترميز أعلاه وتأكيده.",
    "Validé par": "اعتمده",

    // ---- Bassin ----
    "Aucun lot dans le bassin.": "لا توجد مجموعة في الحوض.",
    "Bassin de conservation des éprouvettes": "حوض حفظ العيّنات",
    "Répartissez d'abord des éprouvettes.": "وزّع العيّنات أولاً.",
    "Tous les lots sont sortis pour essai (voir ci-dessous).": "كل المجموعات خرجت للاختبار (انظر أدناه).",
    "Confirmer la sortie pour essai": "تأكيد الإخراج للاختبار",
    "Heure de sortie": "ساعة الإخراج",
    "Sortie en retard (échéance d'essai dépassée) : motif obligatoire.": "إخراج متأخر (تجاوز موعد الاختبار): السبب إجباري.",
    "Jour de sortie prévu (J-1 avant l'essai). Confirmez la sortie pour essai.": "يوم الإخراج المقرر (J-1 قبل الاختبار). أكّد الإخراج للاختبار.",
    "Sortie anticipée (avant l'échéance d'essai) : motif obligatoire.": "إخراج مبكر (قبل موعد الاختبار): السبب إجباري.",
    "Erreur lors de la sortie pour essai :": "خطأ أثناء الإخراج للاختبار:",
    "Erreur lors de la répartition :": "خطأ أثناء التوزيع:",
    "Cette répartition ne peut plus être modifiée : un lot a déjà été sorti pour essai, testé ou archivé.": "لا يمكن تعديل هذا التوزيع: مجموعة خرجت للاختبار أو اختُبرت أو أُرشفت.",
    "Un lot est vide.": "توجد مجموعة فارغة.",
    "Indiquez un âge (jours) valide pour chaque lot.": "أدخل عمرًا صالحًا (بالأيام) لكل مجموعة.",
    "Répartition à revoir": "توزيع لإعادة النظر",
    "Enregistrer les corrections": "حفظ التصحيحات",
    "Opérateur (répartition)": "المُشغّل (التوزيع)",
    "Date prévue d'essai": "تاريخ الاختبار المقرر",
    "Date réelle": "التاريخ الفعلي",
    "Liste des écrasements effectués": "قائمة الاختبارات المنجزة",
    "Liste copiée dans le presse-papiers.": "نُسخت القائمة إلى الحافظة.",
    "Aucun écrasement archivé pour cette période.": "لا يوجد اختبار مؤرشف لهذه الفترة.",
    "Aucun écrasement à partager pour cette période.": "لا يوجد اختبار للمشاركة في هذه الفترة.",
    "Aucun écrasement à exporter pour cette période.": "لا يوجد اختبار للتصدير في هذه الفترة.",
    "(toutes périodes)": "(كل الفترات)",
    "Le motif est obligatoire pour forcer le passage.": "السبب إجباري للمرور القسري.",
    "Profil opérateur requis pour forcer le passage avant 24 h.": "ملف المُشغّل مطلوب للمرور القسري قبل 24 ساعة.",
    "Éprouvette ayant dépassé son séjour": "عيّنة تجاوزت مدة بقائها",
    "Jour férié": "يوم عطلة",
    "Demande du client": "طلب الزبون",
    "Machine indisponible ensuite": "الآلة غير متاحة لاحقًا",

    // ---- Test de compression ----
    "Essai du lot": "اختبار المجموعة",
    "Valider l'essai du lot": "اعتماد اختبار المجموعة",
    "Enregistrer (brouillon)": "حفظ (مسودة)",
    "Vérification avant validation": "تحقق قبل الاعتماد",
    "Confirmer et valider l'essai": "تأكيد الاختبار واعتماده",
    "Code éprouvette": "رمز العيّنة",
    "Appliquer ces dimensions à tout le lot": "تطبيق هذه الأبعاد على كل المجموعة",
    "Dimensions par défaut": "الأبعاد الافتراضية",
    "Cube": "مكعب",
    "Cylindre": "أسطوانة",
    "Larg. (mm)": "العرض (مم)",
    "Long. (mm)": "الطول (مم)",
    "Haut. (mm)": "الارتفاع (مم)",
    "Masse (kg)": "الكتلة (كغ)",
    "Masse": "الكتلة",
    "Date essai": "تاريخ الاختبار",
    "Force (kN)": "القوة (kN)",
    "Rc (MPa)": "Rc (MPa)",
    "Surface": "المساحة",
    "Observation": "ملاحظة",
    "Obs.": "ملاحظة",
    "Dim.": "الأبعاد",
    "Date (âge)": "التاريخ (العمر)",
    // Validation de la repartition par l'ingenieur / le responsable.
    "URGENT — RÉPARTITION NON VALIDÉE": "عاجل — التوزيع غير مُصادق عليه",
    "Les âges et les dates d'essai n'ont pas encore été contrôlés.":
      "لم تُراجَع الأعمار ولا تواريخ الاختبار بعد.",
    "Une erreur d'âge ne se verra qu'à l'échéance, quand il sera trop tard.":
      "خطأ في العمر لن يُكتشف إلا عند الاستحقاق، حين يفوت الأوان.",
    "Valider la répartition de ce coulage": "المصادقة على توزيع هذا الصبّ",
    "Seul un ingénieur ou un responsable peut valider la répartition.":
      "المصادقة على التوزيع محصورة في المهندس أو المسؤول.",
    "Profil requis pour valider une répartition.":
      "الملف الشخصي مطلوب للمصادقة على التوزيع.",
    "Vérifiez que les âges et les dates d'essai sont corrects.":
      "تأكّد من صحّة الأعمار وتواريخ الاختبار.",
    "Vérifiez que l'âge est correct AVANT de sortir le lot.":
      "تأكّد من صحّة العمر قبل إخراج الدفعة.",
    "Rc cyl.": "Rc أسطواني",
    "Moyenne du lot": "معدّل الدفعة",
    // Ecran Validation : trois sections distinctes + validation de repartition.
    "Validation des coulages": "المصادقة على الصبّات",
    "Validation des répartitions": "المصادقة على التوزيعات",
    "Validation des essais d'écrasement": "المصادقة على اختبارات الكسر",
    "Aucune répartition en attente.": "لا يوجد توزيع في الانتظار.",
    "Valider cette répartition": "المصادقة على هذا التوزيع",
    "Répartition validée.": "تمت المصادقة على التوزيع.",
    "À contrôler": "للمراجعة",
    "Réparti par": "وزّعها",
    "Confirmez que ces valeurs sont correctes.": "أكّد صحّة هذه القيم.",
    "Vérifiez que l'âge et la date d'essai correspondent à ce qui a été convenu. Après l'échéance, l'erreur n'est plus rattrapable.":
      "تأكّد من مطابقة العمر وتاريخ الاختبار لما تمّ الاتفاق عليه. بعد الاستحقاق لا يمكن تدارك الخطأ.",
    "Résultats du lot": "نتائج الدفعة",
    "Cubique": "مكعّبي",
    "Cylindrique": "أسطواني",
    "Moyenne": "المعدّل",
    "Minimum": "الأدنى",
    "Maximum": "الأقصى",
    "éprouvettes déjà cylindriques": "عيّنات أسطوانية أصلًا",
    "cubique": "مكعّبي",
    "cylindrique": "أسطواني",
    "équivalent cylindre": "المكافئ الأسطواني",
    "classe": "صنف",
    "facteur": "معامل",
    "de": "من",
    "classe de béton absente : conversion impossible":
      "صنف الخرسانة غير محدّد: التحويل غير ممكن",
    "Jalon 7 j atteint": "بلوغ عتبة 7 أيام",
    "SOUS LE JALON 7 j": "دون عتبة 7 أيام",
    "essai le": "اختبار يوم",
    "Coulé le": "صُبّ يوم",
    "Opérateur": "المُشغّل",
    "Ouvrage": "المنشأ",
    "Âge": "العمر",
    "Nombre": "العدد",
    "jours": "أيام",
    "éprouvette(s)": "عيّنة",
    "Brouillon d'essai enregistré.": "حُفظت مسودّة الاختبار.",
    "Aucun essai enregistré pour l'instant.": "لا يوجد اختبار مسجّل حاليًا.",
    "Aucun essai sur la période sélectionnée.": "لا يوجد اختبار في الفترة المحددة.",
    "Aucun essai sur la période.": "لا يوجد اختبار في الفترة.",
    "Aucun essai à exporter.": "لا يوجد اختبار للتصدير.",
    "Aucun essai à partager sur cette période.": "لا يوجد اختبار للمشاركة في هذه الفترة.",
    "Historique copié dans le presse-papiers.": "نُسخ السجل إلى الحافظة.",
    "Historique partagé.": "تمت مشاركة السجل.",
    "Profil opérateur requis pour valider un essai de compression.": "ملف المُشغّل مطلوب لاعتماد اختبار الضغط.",
    "Date d'essai manquante pour": "تاريخ الاختبار ناقص لـ",
    "Dimensions manquantes pour": "الأبعاد ناقصة لـ",
    "Force ou Rc manquant pour": "القوة أو Rc ناقصة لـ",
    "La date de coulage est obligatoire et doit etre valide.": "تاريخ الصبّ إجباري ويجب أن يكون صالحاً.",
    "Renseignez les résistances pour afficher la moyenne.": "أدخل قيم المقاومة لعرض المتوسط.",
    "Équivalent cylindre :": "المكافئ الأسطواني:",
    "Justification obligatoire (essai hors date prévue).": "التبرير إجباري (اختبار خارج التاريخ المقرر).",
    "Justification écart": "تبرير الفارق",
    "Motif de l'écart": "سبب الفارق",
    "Motif écart": "سبب الفارق",
    "Essai réalisé": "اختبار منجز",
    "Essai hors date prévue (prévu": "اختبار خارج التاريخ المقرر (المقرر",
    "Date réelle d'essai": "تاريخ الاختبار الفعلي",
    "Opérateur :": "المُشغّل:",
    "Période :": "الفترة:",
    "Tous les essais": "كل الاختبارات",
    "Jour férié / non ouvrable": "يوم عطلة / غير عمل",
    "Machine en panne": "الآلة معطّلة",
    "Absence opérateur": "غياب المُشغّل",
    "Dimensions par défaut — Cube :": "الأبعاد الافتراضية — مكعب:",
    "dates différentes": "تواريخ مختلفة",

    // ---- Validation admin ----
    "Aucun coulage en attente.": "لا يوجد صبّ في الانتظار.",
    "Valider ce coulage": "اعتماد هذا الصبّ",
    "Valider le coulage": "اعتماد الصبّ",
    "Valider les résultats": "اعتماد النتائج",
    "Valider ces résultats d'écrasement ?": "اعتماد نتائج الاختبار هذه؟",
    "Ils seront figés et exploitables pour les PV (pont bureau).": "ستُقفل وتصبح جاهزة لمحاضر PV (جسر المكتب).",
    "Coulage validé.": "تم اعتماد الصبّ.",
    "Coulage validé. Médias non supprimés (à re-tenter).": "تم اعتماد الصبّ. لم تُحذف الوسائط (أعد المحاولة).",
    "Coulage validé. Les médias restent en ligne (archivage bureau).": "تم اعتماد الصبّ. تبقى الوسائط على الخادم (أرشفة المكتب).",
    "Résultats validés.": "تم اعتماد النتائج.",
    "Déjà validé.": "معتمَد من قبل.",
    "Déjà validés.": "معتمَدة من قبل.",
    "Échec de la validation.": "فشل الاعتماد.",
    "Échec du renvoi.": "فشل الإعادة.",
    "Indiquez un motif.": "أدخل السبب.",
    "Motif du renvoi (visible par l'opérateur) :": "سبب الإعادة (يراه المُشغّل):",
    "Renvoyé à l'opérateur : la fiche repasse en brouillon.": "أُعيدت إلى المُشغّل: عادت البطاقة مسودّة.",
    "Écran réservé à l'administrateur (réseau requis).": "شاشة خاصة بالمسؤول (الشبكة مطلوبة).",
    "Écran réservé à l'administrateur.": "شاشة خاصة بالمسؤول.",
    "Chargement des médias…": "جارٍ تحميل الوسائط…",
    "Médias non téléversés (soumission hors-ligne ou stockage indisponible).": "لم تُرفع الوسائط (إرسال دون اتصال أو تخزين غير متاح).",
    "Références médias à nettoyer.": "مراجع وسائط للتنظيف.",
    "Média indisponible (": "وسيط غير متاح (",
    "Photo du BL (visible en lot 2)": "صورة وصل التسليم (تظهر في الدفعة 2)",
    "Date du coulage :": "تاريخ الصبّ:",
    "Mode de coulage :": "طريقة الصبّ:",
    "Ouvrage(s) coulé(s) :": "المنشأ (المنشآت) المصبوبة:",
    "Prélèvement :": "العيّنة:",
    "Vérificateur": "المُدقّق",
    "liste incomplète": "قائمة غير كاملة",
    "Modèle enregistré : «": "نموذج محفوظ: «",
    "» (réutilisable).": "» (قابل لإعادة الاستعمال).",

    // ---- Formulations (catalogue) ----
    "Aucune formulation enregistrée.": "لا توجد صيغة محفوظة.",
    "Proposée": "مقترَحة",
    "Désactivée": "معطَّلة",
    "Formulation supprimée.": "حُذفت الصيغة.",
    "Formulation validée : elle est maintenant proposée aux opérateurs.": "اعتُمدت الصيغة: أصبحت متاحة للمُشغّلين.",
    "Fournisseur et nom obligatoires.": "المورّد والاسم إجباريان.",
    "Renseignez au moins la classe ou le dosage.": "أدخل على الأقل الفئة أو الجرعة.",
    "Supprimer cette formulation du catalogue ?": "حذف هذه الصيغة من الكتالوج؟",
    "Il sera utilisable après validation par l'administrateur.": "سيصبح قابلاً للاستعمال بعد اعتماد المسؤول.",
    "Réseau requis pour proposer un modèle (réessayez plus tard).": "الشبكة مطلوبة لاقتراح نموذج (أعد المحاولة لاحقًا).",
    "Échec de la proposition.": "فشل الاقتراح.",
    "Échec de l'enregistrement.": "فشل الحفظ.",
    "Échec.": "فشل.",
    "Nom du modèle pour «": "اسم النموذج لـ «",
    "Modèle proposé : «": "اقتُرح النموذج: «",
    "Un modèle «": "النموذج «",
    "» existe déjà.": "» موجود من قبل.",
    "» enregistrée (validée).": "» محفوظة (معتمَدة).",

    // ---- Déchets ----
    "Indiquez la quantité évacuée.": "أدخل الكمية المُخرَجة.",
    "Le seuil doit être supérieur à 0.": "يجب أن يكون الحد أكبر من 0.",
    "Le poids moyen doit être supérieur à 0.": "يجب أن يكون الوزن المتوسط أكبر من 0.",
    "Paramètres enregistrés.": "حُفظت الإعدادات.",
    "Profil opérateur requis pour confirmer une évacuation.": "ملف المُشغّل مطلوب لتأكيد الإخراج.",
    "Quantité supérieure au stock (": "الكمية أكبر من المخزون (",
    "). Prévoir évacuation des déchets béton / camion.": "). خطّط لإخراج نفايات الخرسانة / الشاحنة.",
    "Seuil d'alerte (éprouvettes)": "حد التنبيه (عيّنات)",
    "Seuil d'alerte déchets (éprouvettes)": "حد تنبيه النفايات (عيّنات)",
    "Seuil d'alerte déchets (éprouvettes écrasées)": "حد تنبيه النفايات (عيّنات مكسّرة)",
    "Poids moyen (kg / éprouvette)": "الوزن المتوسط (كغ / عيّنة)",

    // ---- Administration (opérateurs / labos) ----
    "Nom affiché": "الاسم المعروض",
    "Rôle": "الدور",
    "Identifiant (pour la connexion)": "المعرّف (للدخول)",
    "Code PIN (4 à 6 chiffres)": "الرمز السري PIN (من 4 إلى 6 أرقام)",
    "Ajouter l'opérateur": "إضافة المُشغّل",
    "Ajouter un opérateur": "إضافة مُشغّل",
    "Ajouter le laboratoire": "إضافة المخبر",
    "Ajouter un laboratoire": "إضافة مخبر",
    "Ajouter la formulation": "إضافة الصيغة",
    "Ajouter une formulation validée": "إضافة صيغة معتمَدة",
    "Opérateurs": "المُشغّلون",
    "Laboratoires": "المخابر",
    "Formulations (modèles)": "الصيغ (نماذج)",
    "Aucun opérateur.": "لا يوجد مُشغّل.",
    "Aucun laboratoire.": "لا يوجد مخبر.",
    "Aucun (administrateur, voit tout)": "بدون (مسؤول، يرى الكل)",
    "(désactivé)": "(معطَّل)",
    "Désactivé": "معطَّل",
    "Désactiver": "تعطيل",
    "Réactiver": "إعادة تفعيل",
    "Réinitialiser le PIN": "إعادة تعيين الرمز السري",
    "PIN réinitialisé.": "أُعيد تعيين الرمز السري.",
    "PIN modifié.": "عُدّل الرمز السري.",
    "PIN invalide (4 à 6 chiffres).": "الرمز السري غير صالح (من 4 إلى 6 أرقام).",
    "Nouveau PIN invalide (4 à 6 chiffres).": "الرمز السري الجديد غير صالح (من 4 إلى 6 أرقام).",
    "Nouveau PIN pour @": "الرمز السري الجديد لـ @",
    "(4 à 6 chiffres) :": "(من 4 إلى 6 أرقام):",
    "Votre PIN actuel": "رمزك السري الحالي",
    "Confirmer le PIN": "تأكيد الرمز السري",
    "Confirmer le nouveau PIN": "تأكيد الرمز السري الجديد",
    "Les deux PIN ne correspondent pas.": "الرمزان السريان غير متطابقين.",
    "Le PIN est obligatoire à la création.": "الرمز السري إجباري عند الإنشاء.",
    "Échec du changement de PIN.": "فشل تغيير الرمز السري.",
    "Réseau requis pour changer le PIN. (": "الشبكة مطلوبة لتغيير الرمز السري. (",
    "L'identifiant est obligatoire.": "المعرّف إجباري.",
    "Cet identifiant existe déjà.": "هذا المعرّف موجود من قبل.",
    "Saisissez votre identifiant.": "أدخل معرّفك.",
    "Le nom affiché est obligatoire.": "الاسم المعروض إجباري.",
    "Le nom du laboratoire est obligatoire.": "اسم المخبر إجباري.",
    "Ce nom de laboratoire existe déjà.": "اسم المخبر هذا موجود من قبل.",
    "Choisissez le laboratoire d'affectation.": "اختر مخبر التعيين.",
    "Choisissez un laboratoire d'affectation (obligatoire pour un opérateur).": "اختر مخبر التعيين (إجباري للمُشغّل).",
    "Laboratoire d'affectation": "مخبر التعيين",
    "Laboratoires vérifiés (administrateur — aucun coché = tous)": "المخابر المُصرَّح بالتحقق منها (للمسؤول — بدون تحديد = الكل)",
    "Laboratoire ajouté :": "أُضيف المخبر:",
    "Laboratoire mis à jour.": "حُدّث المخبر.",
    "Laboratoire désactivé.": "عُطّل المخبر.",
    "Laboratoire réactivé.": "أُعيد تفعيل المخبر.",
    "Opérateur ajouté.": "أُضيف المُشغّل.",
    "Opérateur mis à jour.": "حُدّث المُشغّل.",
    "Opérateur désactivé.": "عُطّل المُشغّل.",
    "Opérateur réactivé.": "أُعيد تفعيل المُشغّل.",
    "Action réservée à l'administrateur": "إجراء خاص بالمسؤول",
    "Action réservée à l'administrateur.": "إجراء خاص بالمسؤول.",
    "Connecté.": "متصل.",
    "Connexion refusée.": "رُفض الدخول.",
    "Connexion impossible : vérifiez le réseau (la 1ʳᵉ connexion nécessite Internet).": "تعذّر الدخول: تحقق من الشبكة (الدخول الأول يتطلب الإنترنت).",
    "Session expirée ou compte désactivé : reconnectez-vous.": "انتهت الجلسة أو عُطّل الحساب: أعد تسجيل الدخول.",
    "Serveur non configuré (js/config.js).": "الخادم غير مُهيّأ (js/config.js).",
    "Qualification / fonction": "التأهيل / الوظيفة",
    "Fournisseur / centrale": "المورّد / محطة الخرسانة",
    "Nom / numéro": "الاسم / الرقم",
    "Un laboratoire = un bassin de conservation + une machine d'écrasement (ex. Laboratoire central, Annexe Béchar).": "المخبر = حوض حفظ + آلة اختبار الضغط (مثال: المخبر المركزي، ملحقة بشار).",
    "Opérateurs et laboratoires — gérés en ligne. Chaque opérateur est affecté à un laboratoire (bassin + machine d'écrasement) : il ne voit que les éprouvettes de son labo.": "المُشغّلون والمخابر — يُدارون عبر الإنترنت. كل مُشغّل معيّن في مخبر (حوض + آلة ضغط): لا يرى إلا عيّنات مخبره.",

    // ---- Profil ----
    "Effacer le profil opérateur ?": "مسح ملف المُشغّل؟",
    "Le nom de l'opérateur est obligatoire.": "اسم المُشغّل إجباري.",
    "Profil effacé.": "مُسح الملف.",
    "Profil enregistré :": "حُفظ الملف:",

    // ---- Notifications push ----
    "Sur iPhone : ajoutez d'abord l'app à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis rouvrez-la pour activer les notifications.": "على iPhone: أضف التطبيق أولاً إلى الشاشة الرئيسية (مشاركة ← «إلى الشاشة الرئيسية»)، ثم أعد فتحه لتفعيل الإشعارات.",
    "Échec :": "فشل:",

    // ---- Données & synchronisation / import ----
    "Dernière synchro :": "آخر مزامنة:",
    "Dernier fichier importé :": "آخر ملف مستورد:",
    "Synchroniser depuis le serveur": "المزامنة من الخادم",
    "Synchronisé :": "تمت المزامنة:",
    "Synchronisation…": "جارٍ المزامنة…",
    "projet(s) actifs récupérés du serveur.": "مشروعًا نشطًا اُسترجع من الخادم.",
    "connectez-vous et vérifiez le réseau.": "سجّل الدخول وتحقق من الشبكة.",
    "Connexion et réseau requis.": "الدخول والشبكة مطلوبان.",
    "Import réservé à l'administrateur.": "الاستيراد خاص بالمسؤول.",
    "Envoi au serveur interrompu :": "انقطع الإرسال إلى الخادم:",
    "réseau": "الشبكة",
    "Dernière synchro fichier :": "آخر مزامنة ملف:",
    "Secours bureau (administrateur)": "خيار احتياطي للمكتب (المسؤول)",
    "Importer client.xlsx manuellement": "استيراد client.xlsx يدويًا",
    "Option de secours uniquement. Le flux normal est : modifier dans l'application bureau, enregistrer, puis synchroniser depuis le serveur sur le téléphone.": "خيار احتياطي فقط. المسار العادي هو: التعديل في تطبيق المكتب، الحفظ، ثم المزامنة من الخادم على الهاتف.",
    "Importer client.xlsx vers le serveur": "استيراد client.xlsx إلى الخادم",
    "Récupère les clients et projets gérés par l'administrateur (réseau requis). La saisie fonctionne ensuite hors-ligne sur le terrain.": "يسترجع الزبائن والمشاريع التي يديرها المسؤول (الشبكة مطلوبة). ثم يعمل الإدخال دون اتصال في الميدان.",
    "Administration (opérateurs & laboratoires)": "الإدارة (المُشغّلون والمخابر)",
    "Voir les projets chargés": "عرض المشاريع المحمّلة",
    "Masquer les projets": "إخفاء المشاريع",
    "Aucun projet en mémoire.": "لا يوجد مشروع في الذاكرة.",
    "Aucun import pour l'instant": "لا يوجد استيراد حاليًا",
    "Erreur lors de l'import :": "خطأ أثناء الاستيراد:",
    "Import envoyé au serveur puis synchronisé.": "أُرسل الاستيراد إلى الخادم ثم تمت المزامنة.",
    "Envoi vers le serveur en cours…": "جارٍ الإرسال إلى الخادم…",
    "Format non reconnu. Importez le fichier Excel (.xlsx) du bureau.": "صيغة غير معروفة. استورد ملف Excel ‏(.xlsx) الخاص بالمكتب.",
    "Feuille CLIENTS : colonnes ClientID et NomClient/RaisonSociale requises.": "ورقة CLIENTS: العمودان ClientID و NomClient/RaisonSociale مطلوبان.",
    "Feuille PROJETS : colonnes CodeProjet et NomProjet requises.": "ورقة PROJETS: العمودان CodeProjet و NomProjet مطلوبان.",
    "Feuille PROJETS introuvable dans le fichier.": "ورقة PROJETS غير موجودة في الملف.",
    "La feuille PROJETS est vide.": "ورقة PROJETS فارغة.",
    "Le fichier ne contient aucun projet valide.": "لا يحتوي الملف على أي مشروع صالح.",
    "La connexion nécessite du réseau. Une fois connecté, l'application fonctionne aussi hors-ligne.": "يتطلب الدخول شبكة. بعد الاتصال، يعمل التطبيق أيضًا دون اتصال.",
    "Identifiant (pour la connexion) :": "المعرّف (للدخول):",

    // ---- Données exemple (contrôle interne) ----
    "Contrôle interne (V2.01)": "مراقبة داخلية (V2.01)",
    "Charger données exemple V2.01": "تحميل بيانات تجريبية V2.01",
    "Supprimer données exemple": "حذف البيانات التجريبية",
    "Supprimer uniquement les données exemple DEMO ?": "حذف البيانات التجريبية DEMO فقط؟",
    "Vos vraies fiches sont intactes.": "بطاقاتك الحقيقية سليمة.",
    "Données exemple chargées :": "حُمّلت البيانات التجريبية:",
    "Vérifiez les badges du menu, le bassin et le module Test de compression.": "تحقق من شارات القائمة والحوض ووحدة اختبار الضغط.",
    "Crée des données fictives marquées": "ينشئ بيانات وهمية موسومة",
    "pour tester rapidement les badges, le bassin et le module de compression. Sans effet sur vos vraies fiches.": "لاختبار الشارات والحوض ووحدة الضغط بسرعة. دون تأثير على بطاقاتك الحقيقية.",

    // ---- Divers / en-têtes d'écrans ----
    "Mise à jour": "تحديث",
    "Mise à jour projet": "تحديث المشروع",
    "Module Béton - CAEK": "وحدة الخرسانة - CAEK",
    "Logiciel interne CAEK ENGINEERING LAB — Module Béton · Version 3.0 (en développement)": "برنامج داخلي CAEK ENGINEERING LAB — وحدة الخرسانة · الإصدار 3.0 (قيد التطوير)",
    "Rechercher (entreprise, projet, code, référence, date)…": "بحث (المؤسسة، المشروع، الرمز، المرجع، التاريخ)…",
    "Fiche envoyée — verrouillée.": "أُرسلت البطاقة — مقفلة.",
    "verrouillé": "مقفل",
    "Paramètres": "الإعدادات",
    "Enregistrer les modifications": "حفظ التعديلات",
    "Enregistrer les paramètres": "حفظ الإعدادات",

    // ---- Fragments d'index.html coupés par <strong> ----
    "Coulages soumis par les opérateurs (tous laboratoires). Vérifiez la": "عمليات الصبّ المُرسلة من المُشغّلين (كل المخابر). تحقق من",
    "désignation de l'ouvrage": "تسمية المنشأ",
    "formulation": "الصيغة",
    "validation": "الاعتماد",
    "et la": "و",
    "et le": "و",
    "La": "إنّ",
    ", puis validez — ou renvoyez pour correction avec un motif. La validation ne bloque pas le travail au bassin.": "، ثم اعتمد — أو أعد للتصحيح مع ذكر السبب. الاعتماد لا يوقف العمل في الحوض.",
    "Les prélèvements sont déclarés pendant la saisie de chaque malaxeur. Codification :": "تُصرَّح العيّنات أثناء إدخال كل خلّاطة. الترميز:",
    "RÉF-E1": "المرجع-E1",
    "RÉF-E2": "المرجع-E2",
    "partage au bureau": "المشاركة مع المكتب",
    "se font ensuite depuis le": "يتمان لاحقًا من",
    "Répertoire des coulages": "سجلّ عمليات الصبّ",
    "Catalogue global par fournisseur (ex. BTPH HASNAOUI → N°01, N°02…). Une formulation proposée par un opérateur doit être": "كتالوج شامل حسب المورّد (مثال: BTPH HASNAOUI ← N°01، N°02…). الصيغة المقترحة من مُشغّل يجب أن تكون",
    "validée ici": "معتمَدة هنا",
    "avant d'être utilisable comme modèle.": "قبل أن تصبح قابلة للاستعمال كنموذج.",
    "Fichier Excel": "ملف Excel",
    "du bureau : feuilles": "الخاص بالمكتب: الورقتان",
    "(jointure par ClientID). Le contenu est envoyé sur le serveur puis partagé avec tous les laboratoires.": "(الربط بواسطة ClientID). يُرسل المحتوى إلى الخادم ثم يُشارك مع كل المخابر.",
    "ex. Béchar": "مثال: بشار",
    "ex. Annexe Béchar": "مثال: ملحقة بشار",
    "— Aucun (administrateur, voit tout) —": "— بدون (مسؤول، يرى الكل) —",
    "Validée": "معتمَدة",
    "Envoyé": "مُرسَل",
    "Copier la liste :": "انسخ القائمة:",
    "Écrasements": "اختبارات الضغط",
    "À sortir aujourd'hui (J-1)": "للإخراج اليوم (J-1)",
    "À sortir bientôt (J-2)": "للإخراج قريباً (J-2)",
    "Agrégat 3/8 (kg)": "حصى 3/8 (kg)",
    "Agrégat 8/15 (kg)": "حصى 8/15 (kg)",
    "Agrégat 15/25 (kg)": "حصى 15/25 (kg)",
    "(facultatif — coulage en plusieurs reprises)": "(اختياري — صبّ على عدة مراحل)",

    // ---- Alerte coulage (BF-001), 07/2026 ----
    "Alerte coulage": "تنبيه الصبّ",
    "Informe le laboratoire d'un coulage à venir. N'ouvre, ne préremplit et ne modifie aucune fiche de coulage.":
      "يُعلم المخبر بعملية صبّ مرتقبة. لا يفتح ولا يُعبّئ مسبقًا ولا يُعدّل أي بطاقة صبّ.",
    "Nouvelle alerte coulage": "تنبيه صبّ جديد",
    "Modifier / reporter l'alerte": "تعديل / تأجيل التنبيه",
    "Le laboratoire est déduit automatiquement du projet.": "يُحدَّد المخبر تلقائيًا حسب المشروع.",
    "Ouvrage à couler": "المنشأ المراد صبّه",
    "— Choisir un ouvrage —": "— اختر منشأً —",
    "Niveau / étage": "المستوى / الطابق",
    "Date et heure prévues": "التاريخ والوقت المقرران",
    "Quantité de béton prévue (m³)": "كمية الخرسانة المقررة (m³)",
    "Urgent / dernière minute": "عاجل / اللحظة الأخيرة",
    "Nom du demandeur": "اسم الطالب",
    "Fonction du demandeur": "صفة الطالب",
    "Observations": "ملاحظات",
    "Créer l'alerte": "إنشاء التنبيه",
    "Coulages annoncés": "عمليات الصبّ المُعلَنة",
    "Aucune alerte de coulage active.": "لا يوجد تنبيه صبّ نشط.",
    "Voir l'historique": "عرض السجلّ",
    "Masquer l'historique": "إخفاء السجلّ",
    "Historique (terminées / annulées)": "السجلّ (منتهية / ملغاة)",
    "Aucune alerte terminée ou annulée.": "لا توجد تنبيهات منتهية أو ملغاة.",
    "Connectez-vous pour voir les alertes de coulage.": "سجّل الدخول لعرض تنبيهات الصبّ.",
    "Réseau requis pour créer ou modifier une alerte coulage.": "الشبكة مطلوبة لإنشاء أو تعديل تنبيه صبّ.",
    "Réseau requis pour prendre en charge une alerte.": "الشبكة مطلوبة لتولّي تنبيه.",
    "Choisissez un projet.": "اختر مشروعًا.",
    "Aucun projet ne correspond à ce code.": "لا يوجد مشروع يطابق هذا الرمز.",
    "Indiquez la date et l'heure prévues.": "حدّد التاريخ والوقت المقررين.",
    "Indiquez la quantité de béton prévue (m³).": "حدّد كمية الخرسانة المقررة (m³).",
    "Rôle insuffisant pour planifier une alerte coulage.": "الدور غير كافٍ لبرمجة تنبيه صبّ.",
    "Alerte mise à jour.": "تم تحديث التنبيه.",
    "Alerte créée et notification envoyée au laboratoire.": "أُنشئ التنبيه وأُرسل إشعار إلى المخبر.",
    "Prise en charge confirmée.": "تم تأكيد التولّي.",
    "Reporté": "مؤجَّل",
    "Annulé": "ملغى",
    "Nouvelle date et heure prévues": "التاريخ والوقت الجديدان المقرران",
    "Confirmer le report": "تأكيد التأجيل",
    "Prendre en charge à la place d'un opérateur": "التولّي بدلاً من مُشغّل",
    "Prendre en charge cette alerte à la place d'un opérateur ?": "هل تتولّى هذا التنبيه بدلاً من مُشغّل؟",
    "Déclarer ce coulage annulé ?": "هل تُعلن إلغاء عملية الصبّ هذه؟",
    "Le responsable a été prévenu.": "تم إعلام المسؤول.",
    "Vous n'êtes pas l'opérateur en charge de cette alerte.": "لست المُشغّل المتولّي لهذا التنبيه.",
    "Indiquez la nouvelle date et heure prévues.": "حدّد التاريخ والوقت الجديدين المقررين.",
    "Cette alerte est déjà close.": "هذا التنبيه مُغلق بالفعل.",
    "Annuler cette alerte de coulage ?": "إلغاء تنبيه الصبّ هذا؟",
    "À prendre en charge": "بانتظار التولّي",
    "Prise en charge": "تم التولّي",
    "Reportée": "مؤجَّلة",
    "Annulée": "ملغاة",
    "URGENT": "عاجل",
    "J'ai pris en charge": "توليت الأمر",
    "Modifier / reporter": "تعديل / تأجيل",
    "Pris en charge par": "تولّاه",
    "Non pris en charge": "لم يُتولَّ بعد",
    "Demandé par": "طلبه",
    "moule(s) à préparer": "قالبًا يجب تجهيزه",
    "coulage(s) URGENT annoncé(s) — prise en charge requise.": "عملية صبّ عاجلة مُعلَنة — التولّي مطلوب.",
    "alerte(s) de coulage sans prise en charge — personne n'a accusé réception.": "تنبيه صبّ دون تولٍّ — لم يُؤكّد أحد الاستلام."
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
    ["éprouvettes restantes", "عيّنات متبقية"],
    ["éprouvette restante", "عيّنة متبقية"],
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
    ["Formulation / Centrale", "الصيغة / محطة الخرسانة / مكونات الخرسانة"],
    ["Formulation / BL", "الصيغة / وصل التسليم"],
    ["Bon de livraison", "وصل التسليم"],
    ["Éprouvettes", "العيّنات"],
    ["Anomalie", "خلل"],
    ["Note audio pour l'admin", "ملاحظة صوتية للمسؤول"],
    ["Cube", "مكعب"],
    ["Cylindre", "أسطوانة"],
    ["Mixte", "مختلط"],
    // ---- Fragments dynamiques (passe 07/2026) ----
    ["déchets à évacuer", "نفايات للإخراج"],
    ["retard récupération", "تأخر الاسترجاع"],
    ["sortis pour essai", "خرجت للاختبار"],
    ["sorti pour essai", "خرج للاختبار"],
    ["Sorti pour essai le", "خرج للاختبار بتاريخ"],
    ["lots à tester", "مجموعات للاختبار"],
    ["lot à tester", "مجموعة للاختبار"],
    ["lot(s) sorti(s)", "مجموعة خارجة"],
    ["lot(s) testé(s)", "مجموعة مُختبَرة"],
    ["à récupérer", "للاسترجاع"],
    ["jours depuis le coulage", "أيام منذ الصبّ"],
    ["jour depuis le coulage", "يوم منذ الصبّ"],
    ["— délai de 3 j dépassé", "— تجاوزت مهلة 3 أيام"],
    ["au total", "في المجموع"],
    ["Validé par", "اعتمده"],
    ["validé par", "اعتمده"],
    ["Coulé le", "صُبّ بتاريخ"],
    ["Coulé", "صُبّ"],
    ["sortie le", "أُخرجت بتاريخ"],
    ["écrasé par", "اختبره"],
    ["écrasé le", "اختُبر بتاريخ"],
    ["essai le", "الاختبار بتاريخ"],
    ["prévue le", "مقررة بتاريخ"],
    ["(prévu", "(المقرر"],
    ["fiche à valider", "بطاقة للاعتماد"],
    ["résultat(s) d'écrasement à valider", "نتيجة اختبار للاعتماد"],
    ["média(s) supprimé(s) du serveur.", "وسيطًا حُذف من الخادم."],
    ["Médias soumis (", "الوسائط المُرسلة ("],
    ["Diviser (âge client)", "تقسيم (عمر الزبون)"],
    ["Combien d'éprouvettes détacher de E", "كم عيّنة تُفصل من E"],
    ["pour un autre âge ? (1 à", "لعمر آخر؟ (من 1 إلى"],
    ["Indiquez l'âge (jours) pour chaque lot « Autre… ».", "أدخل العمر (بالأيام) لكل مجموعة «أخرى…»."],
    ["âge d'essai (en jours) pour ces", "عمر الاختبار (بالأيام) لهذه"],
    ["le reste garde son échéance.", "يحتفظ الباقي بموعده."],
    ["Impossible de créer le lot E", "تعذّر إنشاء المجموعة E"],
    ["est déjà dépassée.", "قد فات بالفعل."],
    ["la date prévue d'essai (", "تاريخ الاختبار المقرر ("],
    ["Date prévue d'essai", "تاريخ الاختبار المقرر"],
    ["Date réelle d'essai", "تاريخ الاختبار الفعلي"],
    ["Âge prévu (j)", "العمر المقرر (أيام)"],
    ["Âge réel (j)", "العمر الفعلي (أيام)"],
    ["âge prévu", "العمر المقرر"],
    ["âge réel", "العمر الفعلي"],
    ["Écart (j)", "الفارق (أيام)"],
    ["écart (j)", "الفارق (أيام)"],
    ["Date (âge)", "التاريخ (العمر)"],
    // Validation de la repartition (bandeau, dialogues, tracabilite).
    ["⚠ RÉPARTITION NON VALIDÉE par un ingénieur/responsable.",
      "⚠ التوزيع غير مُصادق عليه من مهندس/مسؤول."],
    ["· RÉPARTITION NON VALIDÉE", "· التوزيع غير مُصادق عليه"],
    ["Répartition validée par", "صادق على التوزيع"],
    ["Répartition validée :", "تمت المصادقة على التوزيع:"],
    ["Valider la répartition de", "المصادقة على توزيع"],
    ["Erreur lors de la validation :", "خطأ أثناء المصادقة:"],
    ["— essai prévu le", "— الاختبار مقرر يوم"],
    ["lot(s) de", "دفعة من"],
    ["Âge :", "العمر:"],
    // Generalisation d'une formulation a tous les malaxeurs.
    ["Appliquer cette formulation à tous les malaxeurs",
      "تطبيق هذه التركيبة على جميع الخلاطات"],
    ["Appliquer la formulation du malaxeur", "تطبيق تركيبة الخلاطة"],
    ["Formulation du malaxeur", "تركيبة الخلاطة"],
    ["La formulation du malaxeur", "تركيبة الخلاطة"],
    ["est vide : renseignez-la avant de la généraliser.",
      "فارغة: املأها قبل تعميمها."],
    ["autre(s) malaxeur(s). Vérifiez puis enregistrez pour valider.",
      "خلاطة أخرى. تحقّق ثم احفظ للمصادقة."],
    ["Les formulations actuellement saisies sur les autres malaxeurs seront",
      "التركيبات المسجّلة حاليًا على الخلاطات الأخرى سوف"],
    ["remplacées.", "تُستبدل."],
    ["Les heures, quantités, affaissements et températures ne",
      "الساعات والكمّيات والهبوط ودرجات الحرارة لا"],
    ["sont PAS modifiés.", "تتغيّر."],
    // Conversion cube -> cylindre et jalon temoin a 7 jours (validation).
    // Acceptation tacite de la repartition (delai ecoule sans reponse).
    ["Répartition acceptée", "تمت الموافقة على التوزيع"],
    ["automatiquement (sans réponse de l'ingénieur dans le délai).",
      "تلقائيًا (دون ردّ المهندس في الأجل)."],
    ["Elle reste celle soumise par", "ويبقى التوزيع الذي قدّمه"],
    ["l'opérateur", "المُشغّل"],
    ["Sans réponse, acceptation automatique dans", "دون ردّ، موافقة تلقائية خلال"],
    ["(au plus tard la veille du 1er essai).", "(على أبعد تقدير عشيّة الاختبار الأول)."],
    ["Acceptation automatique aujourd'hui.", "موافقة تلقائية اليوم."],
    ["Dernier jour", "اليوم الأخير"],
    ["Essai prévu le :", "الاختبار مقرر يوم:"],
    ["répartition(s) ·", "توزيع ·"],
    ["résultat(s) à valider", "نتيجة للمصادقة"],
    ["Échec de la validation (", "فشلت المصادقة ("],
    ["(conversion impossible : classe de béton absente)",
      "(التحويل غير ممكن: صنف الخرسانة غير محدّد)"],
    ["Moyenne Rc cubique :", "معدّل Rc المكعّبي:"],
    ["Moyenne Rc cylindrique :", "معدّل Rc الأسطواني:"],
    ["Équivalent cylindre indisponible : classe de béton",
      "المكافئ الأسطواني غير متاح: صنف الخرسانة"],
    ["Équivalent cylindre :", "المكافئ الأسطواني:"],
    ["Éprouvettes cylindriques : moyenne déjà cylindrique.",
      "عيّنات أسطوانية: المعدّل أسطواني أصلًا."],
    ["Renseignez la classe du coulage pour obtenir la conversion.",
      "أدخل صنف الصبّ للحصول على التحويل."],
    ["illisible («", "غير مقروء («"],
    ["absente", "غير محدّد"],
    ["Sous le jalon 7 j :", "دون عتبة 7 أيام:"],
    ["Jalon 7 j atteint :", "بلوغ عتبة 7 أيام:"],
    ["MPa (75 % de", "MPa (75 % من"],
    ["(facteur", "(معامل"],
    ["Référence coulage", "مرجع الصبّ"],
    ["Opérateur(s) :", "المُشغّل(ون):"],
    ["Opérateur :", "المُشغّل:"],
    ["à l'heure", "في الوقت"],
    ["à sortir bientôt (J-2)", "للإخراج قريباً (J-2)"],
    ["hors de la date prévue", "خارج التاريخ المقرر"],
    ["il a été forcé", "تم فرضه"],
    ["Testé (", "مُختبَر ("],
    ["à tester (", "للاختبار ("],
    ["testés)", "مُختبَرة)"],
    ["épr.", "عيّنة"],
    ["écrasement(s)", "اختبار ضغط"],
    ["évacuée(s) à", "أُخرجت في"],
    ["Évacuation enregistrée. Reste", "سُجّل الإخراج. المتبقي"],
    ["opérateur(s)", "مُشغّل"],
    ["seuil déchets", "حد النفايات"],
    ["Profil opérateur requis", "ملف المُشغّل مطلوب"],
    ["Cette fiche a déjà été validée par l'administrateur.", "هذه البطاقة اعتمدها المسؤول من قبل."],
    ["Fiche déjà validée.", "البطاقة معتمَدة من قبل."],
    ["Aucun laboratoire affecté à votre compte : contactez l'administrateur.", "لا يوجد مخبر معيّن لحسابك: اتصل بالمسؤول."],
    ["Chargement impossible (réseau requis) :", "تعذّر التحميل (الشبكة مطلوبة):"],
    ["Réseau requis :", "الشبكة مطلوبة:"],
    ["Réseau requis", "الشبكة مطلوبة"],
    ["Notifications activées", "الإشعارات مفعّلة"],
    ["sur cet appareil.", "على هذا الجهاز."],
    ["Synchronisé :", "تمت المزامنة:"],
    ["client(s),", "زبونًا،"],
    ["projet(s) actifs récupérés du serveur.", "مشروعًا نشطًا اُسترجع من الخادم."],
    ["projet(s) ignoré(s) (code ou nom manquant)", "مشروعًا مُهملاً (رمز أو اسم ناقص)"],
    ["doublon(s) de code dans le fichier", "رمزًا مكررًا في الملف"],
    ["résistance(s) non numérique(s) ignorée(s)", "مقاومة غير رقمية أُهملت"],
    ["enregistrement(s) « DEMO- » supprimé(s).", "تسجيل «DEMO-» حُذف."],
    ["clients :", "الزبائن:"],
    ["projets :", "المشاريع:"],
    ["Quantité totale [m3] :", "الكمية الإجمالية [m3]:"],
    ["aucun mélange de prélèvements", "دون خلط العيّنات"],
    ["Date du coulage :", "تاريخ الصبّ:"],
    ["codification non confirmée", "ترميز غير مؤكد"],
    ["Renvoyé par l'administrateur :", "أُعيدت من المسؤول:"],
    ["dernier :", "الأخير:"],
    ["Historique des essais de compression", "سجل اختبارات الضغط"],
    ["Historique essais de compression CAEK", "سجل اختبارات الضغط CAEK"],
    ["Âge prévu", "العمر المقرر"],
    ["Âge réel", "العمر الفعلي"],
    ["j, réel", "ي، الفعلي"],
    ["Édité le", "حُرّر بتاريخ"],
    ["· prévu", "· المقرر"],
    ["· écrasé", "· اختُبر"],
    ["Écrasé par", "اختبره"],
    ["3 à 7 jours", "من 3 إلى 7 أيام"],
    ["Âge d'essai (en jours) pour ces", "عمر الاختبار (بالأيام) لهذه"],
    ["modifier les paramètres déchets", "تعديل إعدادات النفايات"],
    ["Renseignez une regle d'echantillonnage valide.", "أدخل قاعدة صالحة لأخذ العينات."],
    ["évacuée(s)", "أُخرجت"],
    ["Réseau requis pour", "الشبكة مطلوبة من أجل"],
    ["ajouter un opérateur", "إضافة مُشغّل"],
    ["ajouter un laboratoire", "إضافة مخبر"],
    ["réinitialiser un PIN", "إعادة تعيين رمز سري"],
    ["Références médias à nettoyer.", "مراجع وسائط للتنظيف."],
    ["— supprimés du serveur après validation", "— تُحذف من الخادم بعد الاعتماد"],
    ["— conservés jusqu'à l'archivage bureau", "— تُحفظ إلى حين أرشفة المكتب"],
    ["Conflit de versions :", "تعارض في الإصدارات:"],
    ["cette fiche a été modifiée sur un autre appareil", "عُدّلت هذه البطاقة على جهاز آخر"],
    ["version serveur", "إصدار الخادم"],
    ["en attente de synchronisation", "في انتظار المزامنة"],
    ["Dernière erreur :", "آخر خطأ:"],
    ["tentative(s)", "محاولة/محاولات"],
    ["Laboratoire introuvable pour ce projet (contactez un administrateur)", "تعذر تحديد المخبر لهذا المشروع (اتصل بالمسؤول)"],
    ["Connexion réseau indisponible", "الاتصال بالشبكة غير متوفر"],
    ["Erreur du serveur, nouvelle tentative automatique", "خطأ في الخادم، إعادة المحاولة تلقائياً"],
    ["Brouillon créé hors-ligne :", "أُنشئت مسودة دون اتصال:"],
    ["(libellé provisoire)", "(تسمية مؤقتة)"],
    ["Révision par éprouvette", "مراجعة لكل عيّنة"],
    ["chaque action est tracée (auteur, rôle, motif, ancien/nouveau)", "كل إجراء مسجَّل (المؤلف، الدور، السبب، القديم/الجديد)"],
    ["Révision enregistrée", "تم تسجيل المراجعة"],
    ["note interne", "ملاحظة داخلية"],
    ["retournée", "مُرجَعة"],
    ["Agrégat 15/25", "حصى 15/25"],
    ["Agrégat 8/15", "حصى 8/15"],
    ["Agrégat 3/8", "حصى 3/8"],
    ["Arrêter (", "إيقاف ("],
    ["Aucun prélèvement", "لا توجد عيّنات"],
    ["Anomalie signalée", "خلل مُبلَّغ عنه"],
    ["Codification confirmée", "ترميز مؤكد"],
    ["Éprouvettes récupérées", "عيّنات مسترجعة"],
    ["début", "البداية"],
    ["aujourd'hui", "اليوم"],
    ["ex. ", "مثال: "],
    // ---- Alerte coulage (BF-001) : fragments à suffixe dynamique ----
    ["Échec : ", "فشل: "],
    ["Déjà pris en charge par", "تولّاه من قبل"],
    ["un autre opérateur", "مُشغّل آخر"]
  ];

  var RULES = [
    { re: /≈ (\d+) moule\(s\) à préparer \(calcul définitif à l'enregistrement\)\./g,
      ar: "≈ $1 قالبًا يجب تجهيزه (الحساب النهائي عند التسجيل)." },
    { re: /(\d+)\s+fiche\(s\)\s+à répartir/g, ar: "$1 بطاقة للتوزيع" },
    { re: /(\d+)\s+fiche(s)?\s+à valider/g, ar: "$1 بطاقة للاعتماد" },
    { re: /éprouvettes?\s+restantes?\s+(\d+)/g, ar: "$1 عيّنة متبقية" },
    { re: /lot\s+à tester\s+(\d+)/g, ar: "$1 مجموعة للاختبار" },
    { re: /(\d+)\s+lot\(s\)\s+à tester/g, ar: "$1 مجموعة للاختبار" },
    { re: /(\d+)\s+lot\(s\)\s+d'essai/g, ar: "$1 مجموعة اختبار" },
    { re: /(\d+)\s+éprouvette\(s\)/g, ar: "$1 عيّنة" },
    { re: /(\d+)\s+éprouvette(s)? cassée(s)?/g, ar: "$1 عيّنة مكسّرة" },
    { re: /(\d+)\s+à sortir aujourd'hui/g, ar: "$1 للإخراج اليوم" },
    { re: /(\d+)\s+en retard/g, ar: "$1 متأخر" },
    { re: /(\d+)\s+bientôt \(J-2\)/g, ar: "$1 قريباً (J-2)" },
    { re: /E(\d+)\s+Cube\s+×(\d+)/g, ar: "E$1 مكعب ×$2" },
    { re: /E(\d+)\s+Cylindre\s+×(\d+)/g, ar: "E$1 أسطوانة ×$2" },
    { re: /E(\d+)\s+Mixte\s+×(\d+)/g, ar: "E$1 مختلط ×$2" },
    // période « du … au … » (archives / historique)
    { re: /du (\d{2}\/\d{2}\/\d{4}|début) au (\d{2}\/\d{2}\/\d{4}|aujourd'hui)/g, ar: "من $1 إلى $2" }
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
    if (n.parentNode && n.parentNode.closest && n.parentNode.closest("[data-i18n-skip]")) { return; }
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
        if (el.closest && el.closest("[data-i18n-skip]")) { continue; }
        var t = (el.getAttribute(attr) || "").trim();
        // Exact d'abord, puis substitutions MIXED (ex. placeholders « ex. … »).
        var tr = t ? (AR[t] || _translateMixed(t)) : "";
        if (tr) {
          var bak = "data-fr-" + attr;
          if (!el.hasAttribute(bak)) { el.setAttribute(bak, el.getAttribute(attr)); }
          el.setAttribute(attr, tr);
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

  // Normalisation des chiffres arabes/persans dès la SAISIE : les valeurs
  // internes (IndexedDB, payloads serveur, exports) restent en chiffres
  // occidentaux quelle que soit la langue d'affichage.
  function _bindDigitNormalizer() {
    document.addEventListener("input", function (ev) {
      var el = ev.target;
      if (!el || !el.tagName) { return; }
      var tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") { return; }
      if (tag === "INPUT") {
        var t = (el.type || "text").toLowerCase();
        if (t !== "text" && t !== "tel" && t !== "search" && t !== "number" && t !== "time" && t !== "date") { return; }
      }
      if (!window.CAEKModel || !CAEKModel.normDigits) { return; }
      var v = el.value;
      var norm = CAEKModel.normDigits(v);
      if (norm === v) { return; }
      var pos = null;
      try { pos = el.selectionStart; } catch (e) {}
      el.value = norm;
      if (pos != null) { try { el.setSelectionRange(pos, pos); } catch (e2) {} }
    }, true);
  }

  function init() {
    _bindToggles();
    _observe();
    _bindDigitNormalizer();
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
