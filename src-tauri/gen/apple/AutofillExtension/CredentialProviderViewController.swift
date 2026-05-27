import AuthenticationServices
import LocalAuthentication
import UIKit
import SQLite3

// Bridge to the Rust core compiled into libapp.a — see src-tauri/src/lib.rs.
@_silgen_name("derive_password_ffi")
func rust_derive_password(_ master: UnsafePointer<Int8>?, _ domain: UnsafePointer<Int8>?, _ email: UnsafePointer<Int8>?, _ profile_json: UnsafePointer<Int8>?) -> UnsafeMutablePointer<Int8>?

@_silgen_name("free_password_ffi")
func rust_free_password(_ s: UnsafeMutablePointer<Int8>?)

@_silgen_name("verify_master_ffi")
func rust_verify_master(_ master: UnsafePointer<Int8>?, _ expected_fp_hex: UnsafePointer<Int8>?) -> Int32

@_silgen_name("record_account_ffi")
func rust_record_account(_ domain: UnsafePointer<Int8>?, _ username: UnsafePointer<Int8>?, _ profile_json: UnsafePointer<Int8>?) -> Int32

class CredentialProviderViewController: ASCredentialProviderViewController, UITableViewDataSource, UITableViewDelegate {

    // MARK: - Configuration

    private static let AppGroup = "group.io.keyfount.app"
    private static let VaultRootRelativePath = "Library/Application Support/Keyfount"
    private static let KeychainService = "io.keyfount.desktop.biometric"
    private static let KeychainAccessGroup = "io.keyfount.shared"

    // MARK: - State

    /// All accounts in the active vault, freshly loaded on unlock.
    private var allAccounts: [AccountEntry] = []
    /// Subset of `allAccounts` whose domain matches `requestedDomain`
    /// (substring match, case-insensitive). Shown in the "Suggestions"
    /// section when non-empty.
    private var suggestions: [AccountEntry] = []
    /// Accounts that don't match `requestedDomain`. Shown in "Tous les
    /// comptes". Also filtered by the search bar.
    private var others: [AccountEntry] = []
    /// Live filter text from the search bar (lowercased). Empty means
    /// "no filter".
    private var searchQuery: String = ""
    private var activeVaultId: String = ""
    private var requestedDomain: String = ""
    /// Cached vault context so we don't re-resolve the path between
    /// unlock and list render.
    private var vaultContext: VaultContext?
    /// Master password held in memory for the lifetime of this
    /// extension presentation. Nil while locked, populated by either
    /// the biometric or the typed-master flow. Cleared on dismiss.
    private var sessionMaster: String?
    /// Whether we've already auto-prompted Face ID for this session —
    /// `viewDidAppear` can fire multiple times if the user backgrounds
    /// then resumes the extension, and we don't want to re-trigger.
    private var biometricAttempted = false

    // MARK: - UI

    private lazy var tableView: UITableView = {
        let table = UITableView(frame: .zero, style: .insetGrouped)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self
        table.delegate = self
        table.register(KeyfountAccountCell.self, forCellReuseIdentifier: "AccountCell")
        table.tableHeaderView = self.searchBar
        table.backgroundColor = KeyfountTheme.surface
        table.separatorColor = KeyfountTheme.line
        table.isHidden = true
        return table
    }()

    private lazy var searchBar: UISearchBar = {
        let s = UISearchBar()
        s.placeholder = "Rechercher (compte, site)"
        s.searchBarStyle = .minimal
        s.autocapitalizationType = .none
        s.autocorrectionType = .no
        s.delegate = self
        s.tintColor = KeyfountTheme.accent
        s.searchTextField.font = KeyfountTheme.Font.body()
        s.searchTextField.textColor = KeyfountTheme.ink
        // Fit the header to its intrinsic size — without this the bar
        // collapses to zero height inside a `tableHeaderView`.
        s.sizeToFit()
        return s
    }()

    private lazy var emptyLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textAlignment = .center
        label.numberOfLines = 0
        label.textColor = KeyfountTheme.inkMuted
        label.font = KeyfountTheme.Font.body()
        label.isHidden = true
        return label
    }()

    // ASCredentialProviderViewController is presented by the system
    // outside a UINavigationController, so we have to lay down our own
    // bar to host the Cancel button.
    private lazy var navigationBar: UINavigationBar = {
        let bar = UINavigationBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        // Match the "Liquid Glass" header treatment from the mobile
        // app (semi-transparent surface with a hairline separator).
        let appearance = UINavigationBarAppearance()
        appearance.configureWithDefaultBackground()
        appearance.backgroundColor = KeyfountTheme.surface.withAlphaComponent(0.85)
        appearance.shadowColor = KeyfountTheme.line
        appearance.titleTextAttributes = [
            .foregroundColor: KeyfountTheme.ink,
            .font: KeyfountTheme.Font.title(),
        ]
        bar.standardAppearance = appearance
        bar.scrollEdgeAppearance = appearance
        bar.tintColor = KeyfountTheme.accent

        let item = UINavigationItem(title: "Keyfount")
        item.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(handleCancel)
        )
        item.rightBarButtonItem = createAccountButton
        bar.items = [item]
        return bar
    }()

    private lazy var createAccountButton: UIBarButtonItem = {
        let item = UIBarButtonItem(
            image: UIImage(systemName: "plus"),
            style: .plain,
            target: self,
            action: #selector(handlePresentCreate)
        )
        // Visible only once we're unlocked and we know the domain.
        item.isEnabled = false
        return item
    }()

    // MARK: - Lock overlay

    private lazy var lockOverlay: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = KeyfountTheme.surface
        return v
    }()

    private lazy var lockTitleLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Déverrouille Keyfount"
        l.font = KeyfountTheme.Font.largeTitle()
        l.textAlignment = .center
        l.textColor = KeyfountTheme.ink
        return l
    }()

    private lazy var lockSubtitleLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Entre ton mot de passe maître"
        l.font = KeyfountTheme.Font.body()
        l.textAlignment = .center
        l.textColor = KeyfountTheme.inkMuted
        return l
    }()

    private lazy var masterField: UITextField = {
        let f = PaddedTextField()
        f.translatesAutoresizingMaskIntoConstraints = false
        f.isSecureTextEntry = true
        f.placeholder = "Mot de passe maître"
        f.returnKeyType = .go
        f.delegate = self
        f.font = KeyfountTheme.Font.body()
        f.textColor = KeyfountTheme.ink
        f.attributedPlaceholder = NSAttributedString(
            string: "Mot de passe maître",
            attributes: [
                .foregroundColor: KeyfountTheme.inkSubtle,
                .font: KeyfountTheme.Font.body(),
            ]
        )
        f.backgroundColor = KeyfountTheme.surfaceElev
        f.layer.borderColor = KeyfountTheme.line.cgColor
        f.layer.borderWidth = 1
        f.layer.cornerRadius = KeyfountTheme.Radius.pill
        f.addTarget(self, action: #selector(masterFieldChanged), for: .editingChanged)
        return f
    }()

    private lazy var unlockButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.setTitle("Déverrouiller", for: .normal)
        b.setTitleColor(KeyfountTheme.primaryButtonForeground, for: .normal)
        b.titleLabel?.font = KeyfountTheme.Font.body(.medium)
        b.backgroundColor = KeyfountTheme.primaryButtonBackground
        b.layer.cornerRadius = KeyfountTheme.Radius.pill
        b.isEnabled = false
        b.alpha = 0.5
        b.addTarget(self, action: #selector(handleUnlockTap), for: .touchUpInside)
        return b
    }()

    private lazy var biometricButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.setTitle("  Utiliser Face ID", for: .normal)
        b.setImage(UIImage(systemName: "faceid"), for: .normal)
        b.tintColor = KeyfountTheme.accent
        b.setTitleColor(KeyfountTheme.accent, for: .normal)
        b.titleLabel?.font = KeyfountTheme.Font.body(.medium)
        b.backgroundColor = KeyfountTheme.accentSoft
        b.layer.cornerRadius = KeyfountTheme.Radius.pill
        b.isHidden = true
        b.addTarget(self, action: #selector(handleBiometricTap), for: .touchUpInside)
        return b
    }()

    private lazy var lockErrorLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.font = KeyfountTheme.Font.caption()
        l.textColor = KeyfountTheme.dangerText
        l.textAlignment = .center
        l.numberOfLines = 0
        l.isHidden = true
        return l
    }()

    private lazy var unlockSpinner: UIActivityIndicatorView = {
        let s = UIActivityIndicatorView(style: .medium)
        s.translatesAutoresizingMaskIntoConstraints = false
        s.hidesWhenStopped = true
        return s
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        KeyfountTheme.registerBundledFonts()
        view.backgroundColor = KeyfountTheme.surface

        view.addSubview(navigationBar)
        view.addSubview(tableView)
        view.addSubview(emptyLabel)
        view.addSubview(lockOverlay)

        lockOverlay.addSubview(lockTitleLabel)
        lockOverlay.addSubview(lockSubtitleLabel)
        lockOverlay.addSubview(masterField)
        lockOverlay.addSubview(unlockButton)
        lockOverlay.addSubview(biometricButton)
        lockOverlay.addSubview(lockErrorLabel)
        lockOverlay.addSubview(unlockSpinner)

        NSLayoutConstraint.activate([
            navigationBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            navigationBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navigationBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            tableView.topAnchor.constraint(equalTo: navigationBar.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            emptyLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            emptyLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            emptyLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),

            lockOverlay.topAnchor.constraint(equalTo: navigationBar.bottomAnchor),
            lockOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            lockOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            lockOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            lockTitleLabel.topAnchor.constraint(equalTo: lockOverlay.topAnchor, constant: 64),
            lockTitleLabel.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            lockTitleLabel.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),

            lockSubtitleLabel.topAnchor.constraint(equalTo: lockTitleLabel.bottomAnchor, constant: 8),
            lockSubtitleLabel.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            lockSubtitleLabel.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),

            masterField.topAnchor.constraint(equalTo: lockSubtitleLabel.bottomAnchor, constant: 32),
            masterField.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            masterField.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),
            masterField.heightAnchor.constraint(equalToConstant: 44),

            unlockButton.topAnchor.constraint(equalTo: masterField.bottomAnchor, constant: 12),
            unlockButton.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            unlockButton.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),
            unlockButton.heightAnchor.constraint(equalToConstant: 48),

            lockErrorLabel.topAnchor.constraint(equalTo: unlockButton.bottomAnchor, constant: 12),
            lockErrorLabel.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            lockErrorLabel.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),

            biometricButton.topAnchor.constraint(equalTo: lockErrorLabel.bottomAnchor, constant: 24),
            biometricButton.leadingAnchor.constraint(equalTo: lockOverlay.leadingAnchor, constant: 24),
            biometricButton.trailingAnchor.constraint(equalTo: lockOverlay.trailingAnchor, constant: -24),
            biometricButton.heightAnchor.constraint(equalToConstant: 48),

            unlockSpinner.centerYAnchor.constraint(equalTo: unlockButton.centerYAnchor),
            unlockSpinner.trailingAnchor.constraint(equalTo: unlockButton.trailingAnchor, constant: -16),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if sessionMaster == nil && !biometricAttempted && biometricEnrolled() {
            biometricAttempted = true
            attemptBiometricUnlock()
        } else if sessionMaster == nil {
            masterField.becomeFirstResponder()
        }
    }

    // MARK: - ASCredentialProviderViewController hooks

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        requestedDomain = Self.extractDomain(from: serviceIdentifiers)

        switch loadVault() {
        case .unavailable(let message):
            // No vault on disk → no auth needed, just show the message.
            lockOverlay.isHidden = true
            showEmptyState(message)
        case .ready(let context):
            vaultContext = context
            activeVaultId = context.activeId
            biometricButton.isHidden = !biometricEnrolled()
            // List stays hidden behind the lock overlay until unlock.
        }
    }

    /// iOS hands us a heterogeneous list — sometimes a `.domain`
    /// identifier (just `apple.com`), sometimes a `.URL` identifier
    /// (`https://idmsa.apple.com/login`). When the extension is opened
    /// from Settings → Passwords (manual browse), the array can be
    /// empty.
    ///
    /// We try `.domain` first, fall back to extracting the host from
    /// the first `.URL`, and lowercase + strip a leading `www.` so the
    /// `LIKE %domain%` suggestion query is stable.
    static func extractDomain(from serviceIdentifiers: [ASCredentialServiceIdentifier]) -> String {
        if let raw = serviceIdentifiers.first(where: { $0.type == .domain })?.identifier {
            return normalizeHost(raw)
        }
        if let urlString = serviceIdentifiers.first(where: { $0.type == .URL })?.identifier,
           let host = URL(string: urlString)?.host {
            return normalizeHost(host)
        }
        return ""
    }

    private static func normalizeHost(_ raw: String) -> String {
        var host = raw.lowercased()
        if host.hasPrefix("www.") {
            host.removeFirst(4)
        }
        return host
    }

    @objc private func handleCancel() {
        extensionContext.cancelRequest(
            withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue)
        )
    }

    // MARK: - Create-account flow

    private var previewWorkItem: DispatchWorkItem?

    @objc private func handlePresentCreate() {
        guard sessionMaster != nil else { return }
        let initialProfile = AutofillProfile.defaultRandom()
        let vc = CreateAccountViewController(
            initialDomain: requestedDomain,
            defaultProfile: initialProfile
        )
        vc.onPreviewRequest = { [weak self, weak vc] payload in
            self?.schedulePreview(for: payload) { password in
                vc?.setPreviewPassword(password)
            }
        }
        vc.onSave = { [weak self] payload in
            self?.commitCreatedAccount(payload)
        }
        let nav = UINavigationController(rootViewController: vc)
        // The CreateAccountVC paints its own UINavigationBar, so we
        // hide the parent nav's bar and present as a form sheet.
        nav.setNavigationBarHidden(true, animated: false)
        nav.modalPresentationStyle = .formSheet
        present(nav, animated: true)
    }

    /// Debounce derive_password by 250ms so we don't fire an Argon2id
    /// derivation on every keystroke. Matches the main app's mobile
    /// account detail sheet behavior.
    private func schedulePreview(for payload: CreateAccountViewController.Result, completion: @escaping (String?) -> Void) {
        previewWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, let master = self.sessionMaster else {
                completion(nil)
                return
            }
            let json = payload.profile.toJSON()
            let password: String? = master.withCString { mPtr in
                payload.domain.withCString { dPtr in
                    payload.username.withCString { uPtr in
                        json.withCString { pPtr in
                            guard let raw = rust_derive_password(mPtr, dPtr, uPtr, pPtr) else { return nil as String? }
                            let s = String(cString: raw)
                            rust_free_password(raw)
                            return s
                        }
                    }
                }
            }
            DispatchQueue.main.async { completion(password) }
        }
        previewWorkItem = work
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    private func commitCreatedAccount(_ payload: CreateAccountViewController.Result) {
        guard let master = sessionMaster else { return }
        let profileJson = payload.profile.toJSON()

        let recordResult: Int32 = payload.domain.withCString { dPtr in
            payload.username.withCString { uPtr in
                profileJson.withCString { pPtr in
                    rust_record_account(dPtr, uPtr, pPtr)
                }
            }
        }

        guard recordResult == 1 else {
            presentError("Échec de l'enregistrement du compte.")
            return
        }

        // Derive the password we're about to fill into the requesting
        // app. We deliberately use the *new* account's domain (could
        // differ from `requestedDomain` if the user edited it in the
        // form) so the stored entry and the filled credential agree.
        let password: String? = master.withCString { mPtr in
            payload.domain.withCString { dPtr in
                payload.username.withCString { uPtr in
                    profileJson.withCString { pPtr in
                        guard let raw = rust_derive_password(mPtr, dPtr, uPtr, pPtr) else { return nil as String? }
                        let s = String(cString: raw)
                        rust_free_password(raw)
                        return s
                    }
                }
            }
        }

        guard let password else {
            presentError("Le compte est enregistré, mais la dérivation a échoué.")
            return
        }

        presentedViewController?.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            let credential = ASPasswordCredential(user: payload.username, password: password)
            self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
        }
    }

    // MARK: - Unlock flow

    @objc private func handleUnlockTap() {
        guard let master = masterField.text, !master.isEmpty else { return }
        attemptMasterUnlock(master: master)
    }

    @objc private func handleBiometricTap() {
        attemptBiometricUnlock()
    }

    private func attemptMasterUnlock(master: String) {
        guard let context = vaultContext else { return }
        guard let fingerprintHex = readFingerprintHex(dbPath: context.dbPath) else {
            showLockError("Aucune empreinte de mot de passe trouvée — ouvre Keyfount d'abord.")
            return
        }

        setUnlockingState(true)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            // Argon2id is intentionally slow — run off the main thread
            // so the spinner stays responsive.
            let result: Int32 = master.withCString { masterPtr in
                fingerprintHex.withCString { fpPtr in
                    rust_verify_master(masterPtr, fpPtr)
                }
            }
            DispatchQueue.main.async {
                self?.setUnlockingState(false)
                switch result {
                case 1:
                    self?.didUnlock(with: master)
                case 0:
                    self?.showLockError("Mot de passe maître incorrect.")
                default:
                    self?.showLockError("Erreur lors de la vérification.")
                }
            }
        }
    }

    private func attemptBiometricUnlock() {
        let context = LAContext()
        let reason = "Déverrouille Keyfount pour remplir tes mots de passe"
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { [weak self] success, _ in
            guard let self else { return }
            DispatchQueue.main.async {
                guard success else { return }
                guard let master = self.readKeychain(account: "keyfount.vault.\(self.activeVaultId).biometric") else {
                    self.showLockError("Verrou biométrique non configuré.")
                    return
                }
                self.didUnlock(with: master)
            }
        }
    }

    private func didUnlock(with master: String) {
        sessionMaster = master
        masterField.text = ""
        masterField.resignFirstResponder()
        createAccountButton.isEnabled = !requestedDomain.isEmpty
        presentAccountList()
        UIView.animate(withDuration: 0.25) {
            self.lockOverlay.alpha = 0
        } completion: { _ in
            self.lockOverlay.isHidden = true
            self.lockOverlay.alpha = 1
        }
    }

    private func setUnlockingState(_ unlocking: Bool) {
        unlockButton.setTitle(unlocking ? "" : "Déverrouiller", for: .normal)
        unlockButton.isEnabled = !unlocking && !(masterField.text ?? "").isEmpty
        unlockButton.alpha = unlockButton.isEnabled ? 1.0 : 0.5
        biometricButton.isEnabled = !unlocking
        masterField.isEnabled = !unlocking
        if unlocking {
            unlockSpinner.startAnimating()
        } else {
            unlockSpinner.stopAnimating()
        }
    }

    @objc private func masterFieldChanged() {
        unlockButton.isEnabled = !(masterField.text ?? "").isEmpty
        unlockButton.alpha = unlockButton.isEnabled ? 1.0 : 0.5
        lockErrorLabel.isHidden = true
    }

    private func showLockError(_ message: String) {
        lockErrorLabel.text = message
        lockErrorLabel.isHidden = false
    }

    /// Presence check that does *not* prompt the user — we ask the
    /// Keychain whether the sealed master exists without requesting its
    /// data, so the biometric button only appears when it actually
    /// resolves to something.
    private func biometricEnrolled() -> Bool {
        guard !activeVaultId.isEmpty else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.KeychainService,
            kSecAttrAccount as String: "keyfount.vault.\(activeVaultId).biometric",
            kSecAttrAccessGroup as String: Self.KeychainAccessGroup,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    // MARK: - Account list

    private func presentAccountList() {
        guard let context = vaultContext else { return }
        allAccounts = queryAllAccounts(dbPath: context.dbPath)
        rebuildSections()

        if allAccounts.isEmpty {
            showEmptyState("Aucun compte enregistré. Ouvre Keyfount pour en créer.")
        } else {
            emptyLabel.isHidden = true
            tableView.isHidden = false
            tableView.reloadData()
        }
    }

    /// Refilter `allAccounts` into the two visible sections after a
    /// data load OR a search-bar change. Suggestions only exist when
    /// we have a `requestedDomain` from iOS.
    private func rebuildSections() {
        let domain = requestedDomain
        let filter = searchQuery

        let matchesFilter: (AccountEntry) -> Bool = { entry in
            guard !filter.isEmpty else { return true }
            return entry.username.lowercased().contains(filter)
                || entry.domain.lowercased().contains(filter)
        }

        if domain.isEmpty {
            suggestions = []
            others = allAccounts.filter(matchesFilter)
        } else {
            suggestions = allAccounts.filter { $0.domain.lowercased().contains(domain) && matchesFilter($0) }
            let suggestionKeys = Set(suggestions.map { "\($0.domain)\u{1F}\($0.username)" })
            others = allAccounts.filter { entry in
                matchesFilter(entry) && !suggestionKeys.contains("\(entry.domain)\u{1F}\(entry.username)")
            }
        }
    }

    // MARK: - UITableViewDataSource / Delegate

    private enum Section: Int, CaseIterable {
        case suggestions = 0
        case others = 1
    }

    private func entries(in section: Section) -> [AccountEntry] {
        switch section {
        case .suggestions: return suggestions
        case .others: return others
        }
    }

    func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        guard let s = Section(rawValue: section) else { return 0 }
        return entries(in: s).count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "AccountCell", for: indexPath) as! KeyfountAccountCell
        guard let s = Section(rawValue: indexPath.section) else { return cell }
        let account = entries(in: s)[indexPath.row]
        cell.configure(username: account.username, domain: account.domain)
        return cell
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        guard let s = Section(rawValue: section) else { return nil }
        switch s {
        case .suggestions:
            return suggestions.isEmpty ? nil : "SUGGESTIONS POUR \(requestedDomain.uppercased())"
        case .others:
            if others.isEmpty { return nil }
            return suggestions.isEmpty ? "TOUS LES COMPTES" : "AUTRES COMPTES"
        }
    }

    func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        guard let header = view as? UITableViewHeaderFooterView else { return }
        // Replace the system grey uppercase header with the theme's
        // mono field-label treatment.
        header.textLabel?.font = KeyfountTheme.Font.fieldLabel()
        header.textLabel?.textColor = KeyfountTheme.inkSubtle
        header.textLabel?.text = header.textLabel?.text  // re-trigger casing
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard let s = Section(rawValue: indexPath.section) else { return }
        let account = entries(in: s)[indexPath.row]
        autofill(account: account)
    }

    // MARK: - Vault loading

    private struct VaultContext {
        let activeId: String
        let dbPath: String
    }

    private enum VaultLookup {
        case ready(VaultContext)
        case unavailable(String)
    }

    private func loadVault() -> VaultLookup {
        guard let sharedURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.AppGroup
        ) else {
            return .unavailable("Conteneur App Group introuvable.")
        }

        let rootURL = sharedURL.appendingPathComponent(Self.VaultRootRelativePath)
        let registryURL = rootURL.appendingPathComponent("vaults.json")

        guard let registryData = try? Data(contentsOf: registryURL),
              let json = try? JSONSerialization.jsonObject(with: registryData) as? [String: Any],
              let activeId = json["activeId"] as? String else {
            return .unavailable("Ouvre Keyfount au moins une fois pour activer un coffre.")
        }

        let dbPath = rootURL.appendingPathComponent(activeId).appendingPathComponent("vault.db").path
        return .ready(VaultContext(activeId: activeId, dbPath: dbPath))
    }

    private func showEmptyState(_ message: String) {
        allAccounts = []
        suggestions = []
        others = []
        tableView.isHidden = true
        emptyLabel.text = message
        emptyLabel.isHidden = false
    }

    // MARK: - Autofill flow

    private func autofill(account: AccountEntry) {
        guard let master = sessionMaster else {
            // Should not happen — list is gated behind unlock.
            presentError("Session verrouillée.")
            return
        }

        let cMaster = master.cString(using: .utf8)
        let cDomain = account.domain.cString(using: .utf8)
        let cEmail = account.username.cString(using: .utf8)
        let cProfile = account.profileJson.cString(using: .utf8)

        guard let cPassword = rust_derive_password(cMaster, cDomain, cEmail, cProfile) else {
            presentError("Échec de la dérivation du mot de passe.")
            return
        }

        let password = String(cString: cPassword)
        rust_free_password(cPassword)

        let credential = ASPasswordCredential(user: account.username, password: password)
        extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
    }

    private func presentError(_ message: String) {
        let alert = UIAlertController(title: "Keyfount", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    // MARK: - SQLite

    struct AccountEntry {
        let domain: String
        let username: String
        let profileJson: String
    }

    /// Load every account in the vault. Filtering into suggestions vs
    /// "Tous" + the search query is done in `rebuildSections()` because
    /// reapplying SQL on every keystroke would be wasteful for a vault
    /// of dozens-to-hundreds of entries.
    private func queryAllAccounts(dbPath: String) -> [AccountEntry] {
        var db: OpaquePointer?
        guard sqlite3_open(dbPath, &db) == SQLITE_OK else { return [] }
        defer { sqlite3_close(db) }

        let query = "SELECT domain, username, profile_json FROM accounts ORDER BY last_used_at DESC;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(statement) }

        var results: [AccountEntry] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let dom = String(cString: sqlite3_column_text(statement, 0))
            let user = String(cString: sqlite3_column_text(statement, 1))
            let prof = String(cString: sqlite3_column_text(statement, 2))
            results.append(AccountEntry(domain: dom, username: user, profileJson: prof))
        }
        return results
    }

    /// Read the master-password fingerprint stored in `settings.fingerprint`
    /// (3 raw bytes hex-encoded). Used by the master-password unlock path
    /// to validate the user's input via `verify_master_ffi`.
    private func readFingerprintHex(dbPath: String) -> String? {
        var db: OpaquePointer?
        guard sqlite3_open(dbPath, &db) == SQLITE_OK else { return nil }
        defer { sqlite3_close(db) }

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT fingerprint FROM settings WHERE id = 1;", -1, &statement, nil) == SQLITE_OK else {
            return nil
        }
        defer { sqlite3_finalize(statement) }

        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        guard let cString = sqlite3_column_text(statement, 0) else { return nil }
        return String(cString: cString)
    }

    // MARK: - Keychain

    /// Reads the sealed master from the shared access group. The main
    /// app stores the item with `kSecAttrAccessGroup = io.keyfount.shared`;
    /// without that key here the lookup is scoped to the extension's own
    /// keychain partition and always misses.
    private func readKeychain(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.KeychainService,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: Self.KeychainAccessGroup,
            kSecReturnData as String: kCFBooleanTrue!,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var dataTypeRef: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &dataTypeRef)

        guard status == errSecSuccess, let data = dataTypeRef as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }
}

// MARK: - UITextFieldDelegate

extension CredentialProviderViewController: UITextFieldDelegate {
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        handleUnlockTap()
        return true
    }
}

// MARK: - UISearchBarDelegate

extension CredentialProviderViewController: UISearchBarDelegate {
    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
        searchQuery = searchText.lowercased()
        rebuildSections()
        tableView.reloadData()
    }

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        searchBar.resignFirstResponder()
    }

    func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
        searchBar.text = ""
        searchQuery = ""
        rebuildSections()
        tableView.reloadData()
        searchBar.resignFirstResponder()
    }
}

// MARK: - PaddedTextField

/// `UITextField` with horizontal padding so it can wear a pill-radius
/// background without text touching the edge. Matches the `.input`
/// class in `theme.css` (`px-3.5` → 14pt insets).
final class PaddedTextField: UITextField {
    private let inset = UIEdgeInsets(top: 0, left: 18, bottom: 0, right: 18)

    override func textRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: inset)
    }
    override func placeholderRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: inset)
    }
    override func editingRect(forBounds bounds: CGRect) -> CGRect {
        bounds.inset(by: inset)
    }
}

// MARK: - KeyfountAccountCell

/// Account row used in the credential list. Mirrors `.account-row` /
/// `.account-row__favicon` from `theme.css`: a rounded surface-elev
/// background with the domain initial in a square favicon-style chip,
/// the username on the primary line, and the domain on the secondary.
final class KeyfountAccountCell: UITableViewCell {
    private let usernameLabel = UILabel()
    private let domainLabel = UILabel()
    private let initialBadge = UILabel()
    private let badgeContainer = UIView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = .clear
        contentView.backgroundColor = .clear
        // The cell already lives inside a grouped section, so we keep
        // the background to the row level and just style the labels.
        accessoryType = .disclosureIndicator
        tintColor = KeyfountTheme.lineStrong

        badgeContainer.translatesAutoresizingMaskIntoConstraints = false
        badgeContainer.backgroundColor = KeyfountTheme.surfaceSunken
        badgeContainer.layer.borderColor = KeyfountTheme.line.cgColor
        badgeContainer.layer.borderWidth = 0.5
        badgeContainer.layer.cornerRadius = KeyfountTheme.Radius.small
        badgeContainer.layer.masksToBounds = true

        initialBadge.translatesAutoresizingMaskIntoConstraints = false
        initialBadge.font = KeyfountTheme.Font.caption(.semibold)
        initialBadge.textColor = KeyfountTheme.inkMuted
        initialBadge.textAlignment = .center
        badgeContainer.addSubview(initialBadge)

        usernameLabel.translatesAutoresizingMaskIntoConstraints = false
        usernameLabel.font = KeyfountTheme.Font.bodyLarge(.medium)
        usernameLabel.textColor = KeyfountTheme.ink
        usernameLabel.lineBreakMode = .byTruncatingTail

        domainLabel.translatesAutoresizingMaskIntoConstraints = false
        domainLabel.font = KeyfountTheme.Font.caption()
        domainLabel.textColor = KeyfountTheme.inkSubtle
        domainLabel.lineBreakMode = .byTruncatingTail

        contentView.addSubview(badgeContainer)
        contentView.addSubview(usernameLabel)
        contentView.addSubview(domainLabel)

        NSLayoutConstraint.activate([
            badgeContainer.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
            badgeContainer.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            badgeContainer.widthAnchor.constraint(equalToConstant: 32),
            badgeContainer.heightAnchor.constraint(equalToConstant: 32),

            initialBadge.centerXAnchor.constraint(equalTo: badgeContainer.centerXAnchor),
            initialBadge.centerYAnchor.constraint(equalTo: badgeContainer.centerYAnchor),

            usernameLabel.leadingAnchor.constraint(equalTo: badgeContainer.trailingAnchor, constant: 12),
            usernameLabel.trailingAnchor.constraint(lessThanOrEqualTo: contentView.layoutMarginsGuide.trailingAnchor),
            usernameLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),

            domainLabel.leadingAnchor.constraint(equalTo: usernameLabel.leadingAnchor),
            domainLabel.trailingAnchor.constraint(equalTo: usernameLabel.trailingAnchor),
            domainLabel.topAnchor.constraint(equalTo: usernameLabel.bottomAnchor, constant: 2),
            domainLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    func configure(username: String, domain: String) {
        usernameLabel.text = username
        domainLabel.text = domain
        initialBadge.text = String(domain.prefix(1)).uppercased()
    }
}
