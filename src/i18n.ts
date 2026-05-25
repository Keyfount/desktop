/**
 * Minimal i18n. Strings are colocated with the desktop app rather than
 * shared with the extension's locale system, because some labels diverge
 * ("Active site" → "Choose a site", "Fill" → "Copy", etc.).
 */

type Locale = "en" | "fr";

const STRINGS = {
  en: {
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

    settings_title: "Settings",
    settings_default_profile: "Default profile",
    settings_auto_lock: "Auto-lock",
    settings_clipboard_clear: "Clipboard auto-clear",
    settings_pin: "PIN",
    settings_history: "Account history",
    settings_favicon_fallback: "Favicon fallback",
    settings_biometric: "Touch ID / Windows Hello",
    settings_autofill: "System autofill",
    settings_hotkey: "Quick-search hotkey",
    settings_sync: "Sync",
    settings_vault_export: "Export vault",
    settings_vault_import: "Import vault",
    settings_about: "About",
    settings_danger: "Danger zone",
    settings_wipe: "Forget this vault",

    sync_title: "Sync",
    sync_intro:
      "Connect a self-hosted Keyfount server to sync your account index across devices. Your master and your passwords never leave this device.",
    sync_server_url: "Server URL",
    sync_test: "Test connection",
    sync_connect: "Connect",
    sync_disconnect: "Disconnect",
    sync_reachable: "Reachable",
    sync_unreachable: "Could not reach the server.",

    vaults_title: "Vaults",
    vaults_new: "New vault",
    vaults_switch: "Switch",
    vaults_delete: "Delete",

    history_setup_title: "Remember accounts?",
    history_setup_body:
      "Optionally save the (site, username) pairs you generate passwords for, so you can pick them again later. Only domain + username are stored — never the password.",
    history_setup_enable: "Enable",
    history_setup_skip: "Skip",
  },
  fr: {
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
    main_domain_placeholder: "example.com",
    main_username_label: "Nom d'utilisateur ou email",
    main_username_placeholder: "alice@example.com",
    main_back_to_list: "Retour aux comptes",
    main_no_email: "Saisissez d'abord un identifiant.",
    main_customize: "Personnaliser",
    main_save_to_history: "Enregistrer",
    main_saved: "Enregistré",

    settings_title: "Réglages",
    settings_default_profile: "Profil par défaut",
    settings_auto_lock: "Verrouillage auto",
    settings_clipboard_clear: "Effacement presse-papiers",
    settings_pin: "PIN",
    settings_history: "Historique des comptes",
    settings_favicon_fallback: "Favicons (fallback)",
    settings_biometric: "Touch ID / Windows Hello",
    settings_autofill: "Remplissage système",
    settings_hotkey: "Raccourci recherche rapide",
    settings_sync: "Synchronisation",
    settings_vault_export: "Exporter le coffre",
    settings_vault_import: "Importer un coffre",
    settings_about: "À propos",
    settings_danger: "Zone dangereuse",
    settings_wipe: "Oublier ce coffre",

    sync_title: "Synchronisation",
    sync_intro:
      "Connectez un serveur Keyfount auto-hébergé pour synchroniser votre index de comptes. Votre mot de passe maître et vos mots de passe ne quittent jamais cet appareil.",
    sync_server_url: "URL du serveur",
    sync_test: "Tester la connexion",
    sync_connect: "Connecter",
    sync_disconnect: "Déconnecter",
    sync_reachable: "Accessible",
    sync_unreachable: "Serveur injoignable.",

    vaults_title: "Coffres",
    vaults_new: "Nouveau coffre",
    vaults_switch: "Activer",
    vaults_delete: "Supprimer",

    history_setup_title: "Mémoriser les comptes ?",
    history_setup_body:
      "Enregistrez optionnellement les couples (site, identifiant) pour les retrouver plus tard. Seuls le domaine et l'identifiant sont stockés — jamais le mot de passe.",
    history_setup_enable: "Activer",
    history_setup_skip: "Plus tard",
  },
} satisfies Record<Locale, Record<string, string | ((arg: string) => string)>>;

const LOCALE: Locale =
  typeof navigator !== "undefined" && navigator.language.startsWith("fr") ? "fr" : "en";

const TABLE = STRINGS[LOCALE];

export function t(key: keyof (typeof STRINGS)["en"], ...args: string[]): string {
  const entry = TABLE[key] ?? STRINGS.en[key];
  if (typeof entry === "function") {
    return (entry as (arg: string) => string)(args[0] ?? "");
  }
  return entry;
}
