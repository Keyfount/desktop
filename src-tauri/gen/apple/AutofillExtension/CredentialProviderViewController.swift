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

class CredentialProviderViewController: ASCredentialProviderViewController, UITableViewDataSource, UITableViewDelegate {

    // MARK: - Configuration

    private static let AppGroup = "group.io.keyfount.app"
    private static let VaultRootRelativePath = "Library/Application Support/Keyfount"
    private static let KeychainService = "io.keyfount.desktop.biometric"
    private static let KeychainAccessGroup = "io.keyfount.shared"

    // MARK: - State

    private var matches: [AccountEntry] = []
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
        table.register(UITableViewCell.self, forCellReuseIdentifier: "AccountCell")
        table.isHidden = true
        return table
    }()

    private lazy var emptyLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textAlignment = .center
        label.numberOfLines = 0
        label.textColor = .secondaryLabel
        label.font = .preferredFont(forTextStyle: .body)
        label.isHidden = true
        return label
    }()

    // ASCredentialProviderViewController is presented by the system
    // outside a UINavigationController, so we have to lay down our own
    // bar to host the Cancel button.
    private lazy var navigationBar: UINavigationBar = {
        let bar = UINavigationBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        let item = UINavigationItem(title: "Keyfount")
        item.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(handleCancel)
        )
        bar.items = [item]
        return bar
    }()

    // MARK: - Lock overlay

    private lazy var lockOverlay: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.backgroundColor = .systemGroupedBackground
        return v
    }()

    private lazy var lockTitleLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Déverrouille Keyfount"
        l.font = .preferredFont(forTextStyle: .title2).withWeight(.semibold)
        l.textAlignment = .center
        l.textColor = .label
        return l
    }()

    private lazy var lockSubtitleLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.text = "Entre ton mot de passe maître"
        l.font = .preferredFont(forTextStyle: .subheadline)
        l.textAlignment = .center
        l.textColor = .secondaryLabel
        return l
    }()

    private lazy var masterField: UITextField = {
        let f = UITextField()
        f.translatesAutoresizingMaskIntoConstraints = false
        f.isSecureTextEntry = true
        f.borderStyle = .roundedRect
        f.placeholder = "Mot de passe maître"
        f.returnKeyType = .go
        f.delegate = self
        f.addTarget(self, action: #selector(masterFieldChanged), for: .editingChanged)
        return f
    }()

    private lazy var unlockButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        var config = UIButton.Configuration.filled()
        config.title = "Déverrouiller"
        config.cornerStyle = .large
        b.configuration = config
        b.isEnabled = false
        b.addTarget(self, action: #selector(handleUnlockTap), for: .touchUpInside)
        return b
    }()

    private lazy var biometricButton: UIButton = {
        let b = UIButton(type: .system)
        b.translatesAutoresizingMaskIntoConstraints = false
        var config = UIButton.Configuration.tinted()
        config.title = "Utiliser Face ID"
        config.image = UIImage(systemName: "faceid")
        config.imagePadding = 8
        config.cornerStyle = .large
        b.configuration = config
        b.isHidden = true
        b.addTarget(self, action: #selector(handleBiometricTap), for: .touchUpInside)
        return b
    }()

    private lazy var lockErrorLabel: UILabel = {
        let l = UILabel()
        l.translatesAutoresizingMaskIntoConstraints = false
        l.font = .preferredFont(forTextStyle: .footnote)
        l.textColor = .systemRed
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
        view.backgroundColor = .systemGroupedBackground

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

    // MARK: - Unlock flow

    @objc private func masterFieldChanged() {
        unlockButton.isEnabled = !(masterField.text ?? "").isEmpty
        lockErrorLabel.isHidden = true
    }

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
        presentAccountList()
        UIView.animate(withDuration: 0.25) {
            self.lockOverlay.alpha = 0
        } completion: { _ in
            self.lockOverlay.isHidden = true
            self.lockOverlay.alpha = 1
        }
    }

    private func setUnlockingState(_ unlocking: Bool) {
        unlockButton.configuration?.title = unlocking ? "" : "Déverrouiller"
        unlockButton.isEnabled = !unlocking && !(masterField.text ?? "").isEmpty
        biometricButton.isEnabled = !unlocking
        masterField.isEnabled = !unlocking
        if unlocking {
            unlockSpinner.startAnimating()
        } else {
            unlockSpinner.stopAnimating()
        }
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
        matches = queryAccounts(dbPath: context.dbPath, domain: requestedDomain)
        if matches.isEmpty {
            let label = requestedDomain.isEmpty
                ? "Aucun compte enregistré."
                : "Aucun compte enregistré pour \(requestedDomain)."
            showEmptyState(label)
        } else {
            emptyLabel.isHidden = true
            tableView.isHidden = false
            tableView.reloadData()
        }
    }

    // MARK: - UITableViewDataSource / Delegate

    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        matches.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "AccountCell", for: indexPath)
        let account = matches[indexPath.row]
        var config = cell.defaultContentConfiguration()
        config.text = account.username
        config.secondaryText = account.domain
        cell.contentConfiguration = config
        cell.accessoryType = .disclosureIndicator
        return cell
    }

    func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        requestedDomain.isEmpty ? "Comptes" : "Comptes pour \(requestedDomain)"
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let account = matches[indexPath.row]
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
        matches = []
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

    private func queryAccounts(dbPath: String, domain: String) -> [AccountEntry] {
        var db: OpaquePointer?
        guard sqlite3_open(dbPath, &db) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_close(db) }

        let query = "SELECT domain, username, profile_json FROM accounts WHERE domain LIKE ?;"
        var statement: OpaquePointer?

        guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else {
            return []
        }
        defer { sqlite3_finalize(statement) }

        let boundDomain = "%\(domain)%"
        sqlite3_bind_text(statement, 1, boundDomain.cString(using: .utf8), -1, nil)

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

// MARK: - UIFont helper

private extension UIFont {
    func withWeight(_ weight: UIFont.Weight) -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: weight]
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}
