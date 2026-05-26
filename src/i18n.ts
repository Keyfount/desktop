/**
 * Minimal i18n. Strings are colocated with the desktop app rather than
 * shared with the extension's locale system, because some labels diverge
 * ("Active site" → "Choose a site", "Fill" → "Copy", etc.).
 */

type Locale = "en" | "fr";
type Entry = string | ((arg: string) => string);

const EN = {
  common_generate: "Generate",
  common_generating: "Generating…",
  common_reveal: "Reveal",
  common_hide: "Hide",
  common_copy: "Copy",
  common_copied: "Copied",
  common_lock: "Lock",
  common_settings: "Settings",
  common_save: "Save",
  common_cancel: "Cancel",
  common_continue: "Continue",
  common_back: "Back",
  common_search: "Search",
  common_quick_search: "Quick search",
  common_open: "Open",
  common_loading: "Loading…",
  common_active: "Active",
  common_new: "New",
  common_delete: "Delete",
  common_preferences: "Preferences",
  common_no_matches: "No matches",

  setup_welcome: "Set up your master password",
  setup_intro:
    "Your master password never leaves this device. It will be hashed locally to produce the same password every time, for every site.",
  setup_master_label: "Master password",
  setup_confirm_label: "Confirm",
  setup_min_length: "At least 12 characters.",
  setup_min_length_error: (n: string) => `Master password must be at least ${n} characters.`,
  setup_mismatch_error: "The two entries do not match.",
  setup_creating: "Setting up…",
  setup_create_button: "Create vault",
  setup_fingerprint_hint:
    "Memorise this fingerprint — you should see the same one every time you unlock.",

  unlock_title: "Unlock",
  unlock_subtitle: "Enter your master password.",
  unlock_pin_subtitle: "Enter your PIN.",
  unlock_button: "Unlock",
  unlock_use_master: "Use master password",
  unlock_use_pin: "Use PIN",
  unlock_use_biometric: "Use Touch ID / Windows Hello",
  unlock_biometric_unavailable: "Biometric unlock is not configured for this vault.",

  main_no_site: "Pick a site to derive a password for.",
  main_domain_label: "Site",
  main_domain_placeholder: "example.com",
  main_username_label: "Username or email",
  main_username_placeholder: "alice@example.com",
  main_back_to_list: "Back to accounts",
  main_no_email: "Enter a username or email first.",
  main_customize: "Customise generation",
  main_save_to_history: "Save",
  main_saved: "Saved",
  main_password_label: "Password",
  main_recompute: "Recompute",
  main_subtitle_derive: "Derive a site password",

  settings_title: "Settings",
  settings_default_profile: "Default profile",
  settings_auto_lock: "Auto-lock",
  settings_clipboard_clear: "Clipboard auto-clear",
  settings_pin: "PIN",
  settings_history: "Account history",
  settings_history_label: "Remember accounts I generate passwords for",
  settings_history_hint:
    "Only the (domain, username) pair is saved — never the derived password.",
  settings_favicon_fallback: "Favicons",
  settings_favicon_label: "Show site favicons via a remote service",
  settings_favicon_hint:
    "Off keeps your account list off any third party. On uses Google's public favicon service.",
  settings_biometric: "Touch ID / Windows Hello",
  settings_autofill: "System autofill",
  settings_autofill_label: "Watch focused password fields and offer to fill them",
  settings_autofill_hint:
    "Opt-in. Requires granting accessibility (macOS) or UI Automation (Windows).",
  settings_hotkey: "Quick-search hotkey",
  settings_sync: "Sync",
  settings_sync_hint: "Connect a self-hosted Keyfount server.",
  settings_vaults: "Vaults",
  settings_vaults_hint: "Switch between vaults or create a new one.",
  settings_vault_export: "Export vault",
  settings_vault_import: "Import vault",
  settings_about: "About",
  settings_danger: "Danger zone",
  settings_wipe: "Forget this vault",

  biometric_toggle_label: "Unlock with Touch ID / Windows Hello",
  biometric_toggle_hint: "Requires biometrics to be enrolled at the OS level.",
  biometric_toggle_not_enrolled_hint:
    "Enrol a fingerprint or face at the OS level to enable this option.",
  biometric_unsupported: "Biometric unlock is not supported on this device yet.",
  biometric_toggle_failed: (reason: string) => `Could not toggle biometric: ${reason}`,

  sidebar_generator: "Generator",
  sidebar_accounts: "Accounts",
  sidebar_sync: "Sync",
  sidebar_vaults: "Vaults",
  sidebar_settings: "Settings",
  sidebar_tagline: "Deterministic vault",
  sidebar_lock: "Lock vault",

  accounts_title: "Accounts",
  accounts_count: (n: string) => `${n} saved`,
  accounts_search_placeholder: "Search accounts…",
  accounts_empty_title: "No accounts yet",
  accounts_empty_hint:
    'Generate a password from the "Generator" tab, then save the (site, username) pair to bring it here.',
  accounts_no_matches_hint: "Try a different search term.",
  accounts_pick_title: "Pick an account",
  accounts_pick_hint: "Select an entry on the left to view its derived password.",
  accounts_derived_password: "Derived password",
  accounts_generation_profile: "Generation profile",
  accounts_delete: "Delete account",
  accounts_chars: (n: string) => `${n} chars`,

  generator_password_label: "Password",
  generator_chars: (n: string) => `${n} chars`,

  profile_random: "Random",
  profile_memorable: "Memorable",
  profile_counter: "Counter",
  profile_length: "Length",
  profile_words: "Words",

  sync_title: "Sync",
  sync_intro:
    "Connect a self-hosted Keyfount server to sync your account index across devices. Your master and your passwords never leave this device.",
  sync_server_url: "Server URL",
  sync_test: "Test connection",
  sync_connect: "Connect",
  sync_disconnect: "Disconnect this device",
  sync_reachable: "Reachable",
  sync_unreachable: "Could not reach the server.",
  sync_chip_connected: "Connected",
  sync_chip_pending: "Pending",
  sync_status_loading: "Checking session…",
  sync_status_disconnected: "Not connected",
  sync_status_connecting: "Connecting…",
  sync_status_pending: "Waiting for admin approval",
  sync_status_approved: "Connected",
  sync_master_reused_title: "Your master password is not asked again",
  sync_master_reused_body:
    "The current unlocked session is used to derive your sync key. If it isn't the right one, the server will reject the connection and you can try again.",
  sync_email_label: "Email",
  sync_email_hint: "Only an HMAC of this email leaves the device; the server never sees plaintext.",
  sync_pending_title: "Waiting for admin approval",
  sync_pending_body:
    "Ask the server administrator to approve this device. The status will refresh automatically every few seconds.",
  sync_pending_cancel: "Cancel and disconnect",
  sync_pull: "Pull",
  sync_pulling: "Pulling…",
  sync_push: "Push",
  sync_pushing: "Pushing…",
  sync_auto_active:
    "Automatic sync is active. Your accounts update across devices without you doing anything.",
  sync_force_label: "Force a manual sync (rarely needed)",
  sync_last_pulled: (n: string) => `Pulled ${n} accounts`,
  sync_last_pushed: (n: string) => `Pushed ${n} accounts`,
  sync_connected_to: "Connected to",
  sync_kv_server: "Server",
  sync_kv_email: "Email",
  sync_kv_user: "User",
  sync_kv_device: "Device",
  sync_kv_fingerprint: "Key fingerprint",
  sync_reach_invalid_url: "Invalid URL. Use http:// or https://.",
  sync_reach_timeout: "Server did not answer within 5 seconds.",
  sync_reach_network:
    "Could not reach the URL. Check it is accessible and CORS is configured.",
  sync_reach_unexpected: "URL replied but does not look like a Keyfount server.",
  sync_reach_http: (code: string) => `Server replied ${code}.`,
  sync_err_locked:
    "The vault is locked. Unlock it from the home screen and retry.",
  sync_err_master_mismatch:
    "The master used to register this server does not match the current session.",
  sync_err_too_many: "Too many failed attempts recently. Retry in a few minutes.",
  sync_err_generic: (msg: string) => `Connection failed: ${msg}`,

  vaults_title: "Vaults",
  vaults_subtitle: (n: string) => `${n} configured`,
  vaults_new: "New vault",
  vaults_switch: "Switch",
  vaults_delete: "Delete",
  vaults_empty: "No vault yet.",
  vaults_label: (id: string) => `Vault ${id}`,
  vaults_created: (date: string) => `Created ${date}`,

  history_setup_title: "Remember accounts?",
  history_setup_body:
    "Optionally save the (site, username) pairs you generate passwords for, so you can pick them again later. Only domain + username are stored — never the password.",
  history_setup_enable: "Enable",
  history_setup_skip: "Skip",
} satisfies Record<string, Entry>;

const FR: Record<keyof typeof EN, Entry> = {
  common_generate: "Générer",
  common_generating: "Génération…",
  common_reveal: "Afficher",
  common_hide: "Masquer",
  common_copy: "Copier",
  common_copied: "Copié",
  common_lock: "Verrouiller",
  common_settings: "Réglages",
  common_save: "Enregistrer",
  common_cancel: "Annuler",
  common_continue: "Continuer",
  common_back: "Retour",
  common_search: "Rechercher",
  common_quick_search: "Recherche rapide",
  common_open: "Ouvrir",
  common_loading: "Chargement…",
  common_active: "Actif",
  common_new: "Nouveau",
  common_delete: "Supprimer",
  common_preferences: "Préférences",
  common_no_matches: "Aucun résultat",

  setup_welcome: "Configurer votre mot de passe maître",
  setup_intro:
    "Votre mot de passe maître ne quitte jamais cet appareil. Il est haché localement pour produire le même mot de passe à chaque fois, pour chaque site.",
  setup_master_label: "Mot de passe maître",
  setup_confirm_label: "Confirmer",
  setup_min_length: "Au moins 12 caractères.",
  setup_min_length_error: (n: string) =>
    `Le mot de passe maître doit faire au moins ${n} caractères.`,
  setup_mismatch_error: "Les deux saisies ne correspondent pas.",
  setup_creating: "Création…",
  setup_create_button: "Créer le coffre",
  setup_fingerprint_hint:
    "Mémorisez cette empreinte — vous devriez voir la même à chaque déverrouillage.",

  unlock_title: "Déverrouiller",
  unlock_subtitle: "Entrez votre mot de passe maître.",
  unlock_pin_subtitle: "Entrez votre code PIN.",
  unlock_button: "Déverrouiller",
  unlock_use_master: "Utiliser le mot de passe",
  unlock_use_pin: "Utiliser le PIN",
  unlock_use_biometric: "Utiliser Touch ID / Windows Hello",
  unlock_biometric_unavailable: "Le déverrouillage biométrique n'est pas configuré.",

  main_no_site: "Choisissez un site pour dériver un mot de passe.",
  main_domain_label: "Site",
  main_domain_placeholder: "exemple.com",
  main_username_label: "Identifiant ou email",
  main_username_placeholder: "alice@exemple.com",
  main_back_to_list: "Retour aux comptes",
  main_no_email: "Saisissez d'abord un identifiant.",
  main_customize: "Personnaliser",
  main_save_to_history: "Enregistrer",
  main_saved: "Enregistré",
  main_password_label: "Mot de passe",
  main_recompute: "Recalculer",
  main_subtitle_derive: "Dériver un mot de passe pour un site",

  settings_title: "Réglages",
  settings_default_profile: "Profil par défaut",
  settings_auto_lock: "Verrouillage auto",
  settings_clipboard_clear: "Effacement presse-papiers",
  settings_pin: "PIN",
  settings_history: "Historique des comptes",
  settings_history_label: "Mémoriser les comptes pour lesquels je génère un mot de passe",
  settings_history_hint:
    "Seul le couple (domaine, identifiant) est enregistré — jamais le mot de passe dérivé.",
  settings_favicon_fallback: "Favicons",
  settings_favicon_label: "Afficher les favicons via un service distant",
  settings_favicon_hint:
    "Désactivé, votre liste de comptes reste à l'abri des tiers. Activé, utilise le service public de Google.",
  settings_biometric: "Touch ID / Windows Hello",
  settings_autofill: "Remplissage système",
  settings_autofill_label: "Surveiller les champs de mot de passe et proposer le remplissage",
  settings_autofill_hint:
    "Optionnel. Nécessite l'accessibilité (macOS) ou UI Automation (Windows).",
  settings_hotkey: "Raccourci recherche rapide",
  settings_sync: "Synchronisation",
  settings_sync_hint: "Connecter un serveur Keyfount auto-hébergé.",
  settings_vaults: "Coffres",
  settings_vaults_hint: "Basculer entre coffres ou en créer un nouveau.",
  settings_vault_export: "Exporter le coffre",
  settings_vault_import: "Importer un coffre",
  settings_about: "À propos",
  settings_danger: "Zone dangereuse",
  settings_wipe: "Oublier ce coffre",

  biometric_toggle_label: "Déverrouiller avec Touch ID / Windows Hello",
  biometric_toggle_hint: "Une empreinte doit être enregistrée au niveau du système.",
  biometric_toggle_not_enrolled_hint:
    "Enregistrez une empreinte ou un visage dans les réglages système pour activer cette option.",
  biometric_unsupported:
    "Le déverrouillage biométrique n'est pas encore disponible sur cet appareil.",
  biometric_toggle_failed: (reason: string) =>
    `Impossible d'activer le déverrouillage biométrique : ${reason}`,

  sidebar_generator: "Générateur",
  sidebar_accounts: "Comptes",
  sidebar_sync: "Synchronisation",
  sidebar_vaults: "Coffres",
  sidebar_settings: "Réglages",
  sidebar_tagline: "Coffre déterministe",
  sidebar_lock: "Verrouiller le coffre",

  accounts_title: "Comptes",
  accounts_count: (n: string) => `${n} enregistré(s)`,
  accounts_search_placeholder: "Rechercher un compte…",
  accounts_empty_title: "Aucun compte pour l'instant",
  accounts_empty_hint:
    "Générez un mot de passe depuis l'onglet \"Générateur\", puis enregistrez le couple (site, identifiant) pour le retrouver ici.",
  accounts_no_matches_hint: "Essayez un autre terme de recherche.",
  accounts_pick_title: "Choisissez un compte",
  accounts_pick_hint: "Sélectionnez une entrée à gauche pour voir son mot de passe dérivé.",
  accounts_derived_password: "Mot de passe dérivé",
  accounts_generation_profile: "Profil de génération",
  accounts_delete: "Supprimer le compte",
  accounts_chars: (n: string) => `${n} caractères`,

  generator_password_label: "Mot de passe",
  generator_chars: (n: string) => `${n} caractères`,

  profile_random: "Aléatoire",
  profile_memorable: "Mémorisable",
  profile_counter: "Compteur",
  profile_length: "Longueur",
  profile_words: "Mots",

  sync_title: "Synchronisation",
  sync_intro:
    "Connectez un serveur Keyfount auto-hébergé pour synchroniser votre index de comptes entre appareils. Votre mot de passe maître et vos mots de passe ne quittent jamais cet appareil.",
  sync_server_url: "URL du serveur",
  sync_test: "Tester la connexion",
  sync_connect: "Se connecter",
  sync_disconnect: "Déconnecter cet appareil",
  sync_reachable: "Accessible",
  sync_unreachable: "Serveur injoignable.",
  sync_chip_connected: "Connecté",
  sync_chip_pending: "En attente",
  sync_status_loading: "Vérification de la session…",
  sync_status_disconnected: "Non connecté",
  sync_status_connecting: "Connexion…",
  sync_status_pending: "En attente d'approbation",
  sync_status_approved: "Connecté",
  sync_master_reused_title: "Votre mot de passe maître n'est pas redemandé",
  sync_master_reused_body:
    "La session déverrouillée actuelle est utilisée pour dériver votre clé de synchronisation. Si ce n'est pas le bon, le serveur refusera la connexion et vous pourrez réessayer.",
  sync_email_label: "Email",
  sync_email_hint:
    "Seul un HMAC de cet email quitte l'appareil ; le serveur ne voit jamais le texte clair.",
  sync_pending_title: "En attente d'approbation",
  sync_pending_body:
    "Demandez à l'administrateur du serveur d'approuver cet appareil. Le statut se rafraîchit automatiquement.",
  sync_pending_cancel: "Annuler et déconnecter",
  sync_pull: "Récupérer",
  sync_pulling: "Récupération…",
  sync_push: "Envoyer",
  sync_pushing: "Envoi…",
  sync_auto_active:
    "Synchronisation automatique activée. Vos comptes se mettent à jour entre vos appareils sans intervention.",
  sync_force_label: "Forcer une synchronisation manuelle (rarement nécessaire)",
  sync_last_pulled: (n: string) => `${n} comptes récupérés`,
  sync_last_pushed: (n: string) => `${n} comptes envoyés`,
  sync_connected_to: "Connecté à",
  sync_kv_server: "Serveur",
  sync_kv_email: "Email",
  sync_kv_user: "Utilisateur",
  sync_kv_device: "Appareil",
  sync_kv_fingerprint: "Empreinte de clé",
  sync_reach_invalid_url: "URL invalide. Utilisez http:// ou https://.",
  sync_reach_timeout: "Le serveur n'a pas répondu en 5 secondes.",
  sync_reach_network:
    "Impossible de joindre l'URL. Vérifiez qu'elle est accessible et que CORS est configuré.",
  sync_reach_unexpected: "L'URL répond mais ne ressemble pas à un serveur Keyfount.",
  sync_reach_http: (code: string) => `Le serveur a répondu ${code}.`,
  sync_err_locked:
    "Le coffre est verrouillé. Déverrouillez-le depuis l'écran d'accueil puis réessayez.",
  sync_err_master_mismatch:
    "Le mot de passe maître utilisé pour enregistrer ce serveur ne correspond pas à la session courante.",
  sync_err_too_many: "Trop de tentatives échouées récentes. Réessayez dans quelques minutes.",
  sync_err_generic: (msg: string) => `Échec de la connexion : ${msg}`,

  vaults_title: "Coffres",
  vaults_subtitle: (n: string) => `${n} configuré(s)`,
  vaults_new: "Nouveau coffre",
  vaults_switch: "Activer",
  vaults_delete: "Supprimer",
  vaults_empty: "Aucun coffre pour l'instant.",
  vaults_label: (id: string) => `Coffre ${id}`,
  vaults_created: (date: string) => `Créé le ${date}`,

  history_setup_title: "Mémoriser les comptes ?",
  history_setup_body:
    "Enregistrez optionnellement les couples (site, identifiant) pour les retrouver plus tard. Seuls le domaine et l'identifiant sont stockés — jamais le mot de passe.",
  history_setup_enable: "Activer",
  history_setup_skip: "Plus tard",
};

const STRINGS: Record<Locale, Record<keyof typeof EN, Entry>> = { en: EN, fr: FR };

const LOCALE: Locale =
  typeof navigator !== "undefined" && navigator.language.startsWith("fr") ? "fr" : "en";

const TABLE = STRINGS[LOCALE];

export function t(key: keyof typeof EN, ...args: string[]): string {
  const entry = TABLE[key] ?? EN[key];
  if (typeof entry === "function") {
    return (entry as (arg: string) => string)(args[0] ?? "");
  }
  return entry;
}
