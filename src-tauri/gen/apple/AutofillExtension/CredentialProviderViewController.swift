import AuthenticationServices
import LocalAuthentication
import UIKit
import SQLite3

// Bridge to the Rust core compiled into libapp.a — these symbols come
// from `derive_password_ffi` / `free_password_ffi` in src-tauri/src/lib.rs.
@_silgen_name("derive_password_ffi")
func rust_derive_password(_ master: UnsafePointer<Int8>?, _ domain: UnsafePointer<Int8>?, _ email: UnsafePointer<Int8>?, _ profile_json: UnsafePointer<Int8>?) -> UnsafeMutablePointer<Int8>?

@_silgen_name("free_password_ffi")
func rust_free_password(_ s: UnsafeMutablePointer<Int8>?)

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

    // MARK: - UI

    private lazy var tableView: UITableView = {
        let table = UITableView(frame: .zero, style: .insetGrouped)
        table.translatesAutoresizingMaskIntoConstraints = false
        table.dataSource = self
        table.delegate = self
        table.register(UITableViewCell.self, forCellReuseIdentifier: "AccountCell")
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

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground

        view.addSubview(navigationBar)
        view.addSubview(tableView)
        view.addSubview(emptyLabel)

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
        ])
    }

    // MARK: - ASCredentialProviderViewController hooks

    /// Triggered when the user opens Keyfount from the AutoFill chooser.
    /// We resolve the active vault, pull matching accounts, and render
    /// them — biometric prompt + derivation runs on selection.
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        requestedDomain = Self.extractDomain(from: serviceIdentifiers)

        switch loadVault() {
        case .unavailable(let message):
            showEmptyState(message)
        case .ready(let context):
            activeVaultId = context.activeId
            matches = queryAccounts(dbPath: context.dbPath, domain: requestedDomain)
            if matches.isEmpty {
                showEmptyState("Aucun compte enregistré pour \(requestedDomain).")
            } else {
                emptyLabel.isHidden = true
                tableView.isHidden = false
                tableView.reloadData()
            }
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
        let context = LAContext()
        let reason = "Déverrouille Keyfount pour remplir le mot de passe"

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { [weak self] success, error in
            guard let self else { return }
            DispatchQueue.main.async {
                guard success else {
                    self.presentError(error?.localizedDescription ?? "Authentification refusée.")
                    return
                }
                self.deriveAndComplete(account: account)
            }
        }
    }

    private func deriveAndComplete(account: AccountEntry) {
        guard let master = readKeychain(account: "keyfount.vault.\(activeVaultId).biometric") else {
            presentError("Le verrouillage biométrique n'est pas activé pour ce coffre.")
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
