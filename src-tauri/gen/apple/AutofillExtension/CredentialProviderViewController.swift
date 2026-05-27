import AuthenticationServices
import LocalAuthentication
import UIKit
import SQLite3

// Map to C-FFI symbols using swift private attributes
@_silgen_name("derive_password_ffi")
func rust_derive_password(_ master: UnsafePointer<Int8>?, _ domain: UnsafePointer<Int8>?, _ email: UnsafePointer<Int8>?, _ profile_json: UnsafePointer<Int8>?) -> UnsafeMutablePointer<Int8>?

@_silgen_name("free_password_ffi")
func rust_free_password(_ s: UnsafeMutablePointer<Int8>?)

class CredentialProviderViewController: ASCredentialProviderViewController {
    
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let requestedDomain = serviceIdentifiers.first(where: { $0.type == .domain })?.identifier ?? ""
        
        let fileManager = FileManager.default
        guard let sharedURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.io.keyfount.app") else {
            self.extensionContext.cancelRequest(withError: NSError(domain: "Autofill", code: 1, userInfo: [NSLocalizedDescriptionKey: "Shared App Group container not found"]))
            return
        }
        
        // Keyfount places its registry inside "HOME/Library/Application Support/Keyfount/vaults.json"
        // Let's resolve the active vault ID from the vaults.json registry
        let rootURL = sharedURL.appendingPathComponent("Library/Application Support/Keyfount")
        let registryURL = rootURL.appendingPathComponent("vaults.json")
        
        guard let registryData = try? Data(contentsOf: registryURL),
              let json = try? JSONSerialization.jsonObject(with: registryData) as? [String: Any],
              let activeId = json["activeId"] as? String else {
            self.extensionContext.cancelRequest(withError: NSError(domain: "Autofill", code: 2, userInfo: [NSLocalizedDescriptionKey: "No active vault registry found"]))
            return
        }
        
        // SQLite database path: HOME/Library/Application Support/Keyfount/{vault_id}/vault.db
        let dbPath = rootURL.appendingPathComponent(activeId).appendingPathComponent("vault.db").path
        
        // Query database for accounts
        let accounts = queryAccounts(dbPath: dbPath, domain: requestedDomain)
        
        if accounts.isEmpty {
            self.extensionContext.cancelRequest(withError: NSError(domain: "Autofill", code: 3, userInfo: [NSLocalizedDescriptionKey: "No accounts found for \(requestedDomain)"]))
            return
        }
        
        // Pick the first matching account and unlock it via biometrics
        guard let account = accounts.first else { return }
        
        let context = LAContext()
        context.localizedReason = "Unlock Keyfount to autofill your password"
        
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: context.localizedReason) { success, error in
            guard success else {
                self.extensionContext.cancelRequest(withError: error ?? NSError(domain: "Autofill", code: 4, userInfo: nil))
                return
            }
            
            // Retrieve master password from keychain
            guard let master = self.readKeychain(account: "keyfount.vault.\(activeId).biometric") else {
                self.extensionContext.cancelRequest(withError: NSError(domain: "Autofill", code: 5, userInfo: [NSLocalizedDescriptionKey: "Vault credentials not found in keychain"]))
                return
            }
            
            // Run password derivation FFI
            let cMaster = master.cString(using: .utf8)
            let cDomain = account.domain.cString(using: .utf8)
            let cEmail = account.username.cString(using: .utf8)
            let cProfile = account.profileJson.cString(using: .utf8)
            
            guard let cPassword = rust_derive_password(cMaster, cDomain, cEmail, cProfile) else {
                self.extensionContext.cancelRequest(withError: NSError(domain: "Autofill", code: 6, userInfo: [NSLocalizedDescriptionKey: "Password derivation failed"]))
                return
            }
            
            let password = String(cString: cPassword)
            rust_free_password(cPassword)
            
            // Auto-fill credential
            let credential = ASPasswordCredential(user: account.username, password: password)
            self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
        }
    }
    
    // SQLite query helper
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
        
        // Handle fuzzy matching (e.g. apple.com matches subdomains)
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
    
    // Keychain helper. The main app stores the sealed master under the
    // shared access group; without `kSecAttrAccessGroup` here the
    // lookup is scoped to the extension's own keychain partition (which
    // is always empty) and we'd silently fail with errSecItemNotFound.
    private static let KeychainService = "io.keyfount.desktop.biometric"
    private static let KeychainAccessGroup = "io.keyfount.shared"

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
