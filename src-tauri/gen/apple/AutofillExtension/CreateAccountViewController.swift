import UIKit

/// Form presented when the user taps "+" in the AutoFill picker to
/// create a brand-new account directly from the extension. Mirrors the
/// main app's `ProfileEditor` (Random or Memorable + per-mode knobs)
/// with a live password preview so the user sees exactly what they're
/// about to commit.
///
/// Everything is in-memory: the controller takes a pre-filled
/// `(domain, username, profile)` and a closure to invoke on Save. The
/// caller (CredentialProviderViewController) owns the storage write
/// and the biometric / master session, so this VC never touches the
/// Keychain or SQLite directly.
final class CreateAccountViewController: UITableViewController, UITextFieldDelegate {

    // MARK: - Public API

    struct Result {
        let domain: String
        let username: String
        let profile: AutofillProfile
    }

    /// Live preview hook — called whenever the form's identity or
    /// profile changes. The caller derives a password and pushes it
    /// back via `setPreviewPassword`. Debouncing is the caller's
    /// responsibility.
    var onPreviewRequest: ((Result) -> Void)?
    /// Final callback when the user taps "Créer". The caller is
    /// expected to persist and dismiss.
    var onSave: ((Result) -> Void)?

    /// Inject the latest derived password to show in the footer.
    func setPreviewPassword(_ password: String?) {
        previewLabel.text = password ?? " "
    }

    // MARK: - State

    private var domain: String
    private var username: String = ""
    private var profile: AutofillProfile

    init(initialDomain: String, defaultProfile: AutofillProfile) {
        self.domain = initialDomain
        self.profile = defaultProfile
        super.init(style: .insetGrouped)
        title = "Nouveau compte"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) not implemented") }

    // MARK: - UI components

    private lazy var navigationBar: UINavigationBar = {
        let bar = UINavigationBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
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

        let item = UINavigationItem(title: "Nouveau compte")
        item.leftBarButtonItem = UIBarButtonItem(title: "Annuler", style: .plain, target: self, action: #selector(handleCancel))
        item.rightBarButtonItem = saveButton
        bar.items = [item]
        return bar
    }()

    private lazy var saveButton: UIBarButtonItem = {
        let b = UIBarButtonItem(title: "Créer", style: .done, target: self, action: #selector(handleSave))
        b.isEnabled = false
        b.setTitleTextAttributes(
            [.font: KeyfountTheme.Font.body(.semibold), .foregroundColor: KeyfountTheme.accent],
            for: .normal
        )
        return b
    }()

    private lazy var domainField: UITextField = {
        let f = themedField(placeholder: "exemple.com")
        f.text = domain
        f.keyboardType = .URL
        f.returnKeyType = .next
        f.addTarget(self, action: #selector(domainChanged), for: .editingChanged)
        return f
    }()

    private lazy var usernameField: UITextField = {
        let f = themedField(placeholder: "Identifiant ou email")
        f.keyboardType = .emailAddress
        f.returnKeyType = .done
        f.addTarget(self, action: #selector(usernameChanged), for: .editingChanged)
        return f
    }()

    private func themedField(placeholder: String) -> UITextField {
        let f = PaddedTextField()
        f.autocapitalizationType = .none
        f.autocorrectionType = .no
        f.delegate = self
        f.font = KeyfountTheme.Font.body()
        f.textColor = KeyfountTheme.ink
        f.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [
                .foregroundColor: KeyfountTheme.inkSubtle,
                .font: KeyfountTheme.Font.body(),
            ]
        )
        f.backgroundColor = KeyfountTheme.surfaceElev
        f.layer.borderColor = KeyfountTheme.line.cgColor
        f.layer.borderWidth = 1
        f.layer.cornerRadius = KeyfountTheme.Radius.pill
        f.heightAnchor.constraint(equalToConstant: 40).isActive = true
        return f
    }

    private lazy var modeSegment: UISegmentedControl = {
        let s = UISegmentedControl(items: ["Aléatoire", "Mémorisable"])
        s.selectedSegmentIndex = profile.isRandom ? 0 : 1
        s.selectedSegmentTintColor = KeyfountTheme.surfaceElev
        s.backgroundColor = KeyfountTheme.surfaceSunken
        s.setTitleTextAttributes(
            [.foregroundColor: KeyfountTheme.inkMuted, .font: KeyfountTheme.Font.caption()],
            for: .normal
        )
        s.setTitleTextAttributes(
            [.foregroundColor: KeyfountTheme.ink, .font: KeyfountTheme.Font.caption(.semibold)],
            for: .selected
        )
        s.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
        return s
    }()

    private lazy var previewLabel: UILabel = {
        let l = UILabel()
        l.font = KeyfountTheme.Font.mono(16)
        l.textColor = KeyfountTheme.ink
        l.textAlignment = .center
        l.numberOfLines = 0
        l.text = " "
        return l
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        KeyfountTheme.registerBundledFonts()
        view.backgroundColor = KeyfountTheme.surface

        // The table is the root view of UITableViewController, but we
        // still need our own nav bar (no parent UINavigationController
        // when presented from the credential extension).
        let nav = navigationBar
        view.addSubview(nav)
        NSLayoutConstraint.activate([
            nav.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            nav.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            nav.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        tableView.contentInset.top = nav.intrinsicContentSize.height
        tableView.backgroundColor = KeyfountTheme.surface
        tableView.separatorColor = KeyfountTheme.line

        tableView.keyboardDismissMode = .interactive
        tableView.allowsSelection = false
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "Cell")

        refreshSaveEnabled()
        requestPreview()
    }

    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        guard let header = view as? UITableViewHeaderFooterView else { return }
        header.textLabel?.font = KeyfountTheme.Font.fieldLabel()
        header.textLabel?.textColor = KeyfountTheme.inkSubtle
    }

    override func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
        cell.backgroundColor = KeyfountTheme.surfaceElev
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        usernameField.becomeFirstResponder()
    }

    // MARK: - Actions

    @objc private func handleCancel() {
        dismiss(animated: true)
    }

    @objc private func handleSave() {
        guard let payload = currentResult() else { return }
        onSave?(payload)
    }

    @objc private func domainChanged() {
        domain = domainField.text ?? ""
        refreshSaveEnabled()
        requestPreview()
    }

    @objc private func usernameChanged() {
        username = usernameField.text ?? ""
        refreshSaveEnabled()
        requestPreview()
    }

    @objc private func modeChanged() {
        profile = modeSegment.selectedSegmentIndex == 0
            ? AutofillProfile.defaultRandom()
            : AutofillProfile.defaultMemorable()
        tableView.reloadSections(IndexSet(integer: Section.parameters.rawValue), with: .automatic)
        requestPreview()
    }

    private func refreshSaveEnabled() {
        saveButton.isEnabled = !domain.trimmingCharacters(in: .whitespaces).isEmpty
            && !username.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func currentResult() -> Result? {
        let trimmedDomain = domain.lowercased().trimmingCharacters(in: .whitespaces)
        let trimmedUsername = username.trimmingCharacters(in: .whitespaces)
        guard !trimmedDomain.isEmpty, !trimmedUsername.isEmpty else { return nil }
        return Result(domain: trimmedDomain, username: trimmedUsername, profile: profile)
    }

    private func requestPreview() {
        guard let payload = currentResult() else {
            setPreviewPassword(nil)
            return
        }
        onPreviewRequest?(payload)
    }

    // MARK: - UITextFieldDelegate

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if textField === domainField {
            usernameField.becomeFirstResponder()
        } else {
            textField.resignFirstResponder()
        }
        return true
    }

    // MARK: - Sections

    private enum Section: Int, CaseIterable {
        case identity = 0
        case mode = 1
        case parameters = 2
        case preview = 3
    }

    override func numberOfSections(in tableView: UITableView) -> Int {
        Section.allCases.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        guard let s = Section(rawValue: section) else { return 0 }
        switch s {
        case .identity: return 2
        case .mode: return 1
        case .parameters: return parameterRows().count
        case .preview: return 1
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        guard let s = Section(rawValue: section) else { return nil }
        switch s {
        case .identity: return "Compte"
        case .mode: return "Type de mot de passe"
        case .parameters: return "Paramètres"
        case .preview: return "Aperçu"
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard let s = Section(rawValue: indexPath.section) else {
            return tableView.dequeueReusableCell(withIdentifier: "Cell", for: indexPath)
        }
        switch s {
        case .identity:
            return identityCell(row: indexPath.row, tableView: tableView, indexPath: indexPath)
        case .mode:
            return modeCell(tableView: tableView, indexPath: indexPath)
        case .parameters:
            return parameterCell(row: indexPath.row, tableView: tableView, indexPath: indexPath)
        case .preview:
            return previewCell(tableView: tableView, indexPath: indexPath)
        }
    }

    // MARK: - Cell builders

    private func identityCell(row: Int, tableView: UITableView, indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "Cell", for: indexPath)
        cell.contentView.subviews.forEach { $0.removeFromSuperview() }
        let field = row == 0 ? domainField : usernameField
        let title = row == 0 ? "Domaine" : "Identifiant"
        let label = UILabel()
        label.text = title
        label.font = KeyfountTheme.Font.body()
        label.textColor = KeyfountTheme.ink
        label.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(label)
        cell.contentView.addSubview(field)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
            label.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            label.widthAnchor.constraint(equalToConstant: 96),

            field.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 12),
            field.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
            field.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),

            cell.contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 56),
        ])
        return cell
    }

    private func modeCell(tableView: UITableView, indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "Cell", for: indexPath)
        cell.contentView.subviews.forEach { $0.removeFromSuperview() }
        modeSegment.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(modeSegment)
        NSLayoutConstraint.activate([
            modeSegment.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
            modeSegment.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
            modeSegment.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 8),
            modeSegment.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -8),
        ])
        return cell
    }

    private func previewCell(tableView: UITableView, indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "Cell", for: indexPath)
        cell.contentView.subviews.forEach { $0.removeFromSuperview() }
        previewLabel.translatesAutoresizingMaskIntoConstraints = false
        cell.contentView.addSubview(previewLabel)
        NSLayoutConstraint.activate([
            previewLabel.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
            previewLabel.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
            previewLabel.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 12),
            previewLabel.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -12),
        ])
        return cell
    }

    // MARK: - Parameter rows (vary by mode)

    private enum ParameterRow {
        case slider(label: String, value: Double, min: Double, max: Double, step: Double, onChange: (Double) -> Void)
        case toggle(label: String, value: Bool, onChange: (Bool) -> Void)
        case stepper(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Void)
        case picker(label: String, options: [String], selected: Int, onChange: (Int) -> Void)
    }

    private func parameterRows() -> [ParameterRow] {
        switch profile {
        case .random(var p):
            return [
                .slider(label: "Longueur (\(p.length))", value: Double(p.length), min: 5, max: 35, step: 1) { [weak self] v in
                    p.length = UInt32(v.rounded())
                    self?.profile = .random(p)
                    self?.tableView.reloadSections(IndexSet(integer: Section.parameters.rawValue), with: .none)
                    self?.requestPreview()
                },
                .toggle(label: "Minuscules", value: p.lower) { [weak self] v in
                    p.lower = v; self?.profile = .random(p); self?.requestPreview()
                },
                .toggle(label: "Majuscules", value: p.upper) { [weak self] v in
                    p.upper = v; self?.profile = .random(p); self?.requestPreview()
                },
                .toggle(label: "Chiffres", value: p.digits) { [weak self] v in
                    p.digits = v; self?.profile = .random(p); self?.requestPreview()
                },
                .toggle(label: "Symboles", value: p.symbols) { [weak self] v in
                    p.symbols = v; self?.profile = .random(p); self?.requestPreview()
                },
                .stepper(label: "Compteur", value: Int(p.counter), min: 1, max: 999) { [weak self] v in
                    p.counter = UInt32(v); self?.profile = .random(p); self?.requestPreview()
                },
            ]
        case .memorable(var p):
            return [
                .stepper(label: "Nombre de mots (\(p.wordCount))", value: Int(p.wordCount), min: 5, max: 8) { [weak self] v in
                    p.wordCount = UInt32(v); self?.profile = .memorable(p)
                    self?.tableView.reloadSections(IndexSet(integer: Section.parameters.rawValue), with: .none)
                    self?.requestPreview()
                },
                .picker(label: "Séparateur", options: ["-", ".", "_"], selected: p.separator.pickerIndex) { [weak self] idx in
                    p.separator = MemorableSeparator.fromPickerIndex(idx)
                    self?.profile = .memorable(p); self?.requestPreview()
                },
                .toggle(label: "Mot capitalisé", value: p.capitalise) { [weak self] v in
                    p.capitalise = v; self?.profile = .memorable(p); self?.requestPreview()
                },
                .toggle(label: "Suffixe chiffre/symbole", value: p.suffix) { [weak self] v in
                    p.suffix = v; self?.profile = .memorable(p); self?.requestPreview()
                },
                .stepper(label: "Compteur", value: Int(p.counter), min: 1, max: 999) { [weak self] v in
                    p.counter = UInt32(v); self?.profile = .memorable(p); self?.requestPreview()
                },
            ]
        }
    }

    private func parameterCell(row: Int, tableView: UITableView, indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "Cell", for: indexPath)
        cell.contentView.subviews.forEach { $0.removeFromSuperview() }
        let item = parameterRows()[row]

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = KeyfountTheme.Font.body()
        label.textColor = KeyfountTheme.ink
        cell.contentView.addSubview(label)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
            label.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            cell.contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])

        switch item {
        case .slider(let title, let value, let min, let max, let step, let onChange):
            label.text = title
            let slider = UISlider()
            slider.translatesAutoresizingMaskIntoConstraints = false
            slider.minimumValue = Float(min)
            slider.maximumValue = Float(max)
            slider.value = Float(value)
            slider.tintColor = KeyfountTheme.accent
            slider.minimumTrackTintColor = KeyfountTheme.accent
            slider.maximumTrackTintColor = KeyfountTheme.line
            slider.thumbTintColor = KeyfountTheme.accent
            slider.addAction(UIAction { [weak slider] _ in
                guard let s = slider else { return }
                let snapped = (Double(s.value) / step).rounded() * step
                onChange(snapped)
            }, for: .valueChanged)
            cell.contentView.addSubview(slider)
            NSLayoutConstraint.activate([
                slider.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 16),
                slider.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                slider.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            ])

        case .toggle(let title, let value, let onChange):
            label.text = title
            let toggle = UISwitch()
            toggle.translatesAutoresizingMaskIntoConstraints = false
            toggle.isOn = value
            toggle.onTintColor = KeyfountTheme.accent
            toggle.addAction(UIAction { [weak toggle] _ in
                guard let t = toggle else { return }
                onChange(t.isOn)
            }, for: .valueChanged)
            cell.contentView.addSubview(toggle)
            NSLayoutConstraint.activate([
                toggle.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                toggle.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            ])

        case .stepper(let title, let value, let min, let max, let onChange):
            label.text = title
            let stepper = UIStepper()
            stepper.translatesAutoresizingMaskIntoConstraints = false
            stepper.minimumValue = Double(min)
            stepper.maximumValue = Double(max)
            stepper.value = Double(value)
            stepper.addAction(UIAction { [weak stepper, weak self] _ in
                guard let s = stepper else { return }
                onChange(Int(s.value.rounded()))
                self?.tableView.reloadSections(IndexSet(integer: Section.parameters.rawValue), with: .none)
            }, for: .valueChanged)
            cell.contentView.addSubview(stepper)
            NSLayoutConstraint.activate([
                stepper.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                stepper.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
            ])

        case .picker(let title, let options, let selected, let onChange):
            label.text = title
            let segment = UISegmentedControl(items: options)
            segment.translatesAutoresizingMaskIntoConstraints = false
            segment.selectedSegmentIndex = selected
            segment.selectedSegmentTintColor = KeyfountTheme.surfaceElev
            segment.backgroundColor = KeyfountTheme.surfaceSunken
            segment.setTitleTextAttributes(
                [.foregroundColor: KeyfountTheme.inkMuted, .font: KeyfountTheme.Font.caption()],
                for: .normal
            )
            segment.setTitleTextAttributes(
                [.foregroundColor: KeyfountTheme.ink, .font: KeyfountTheme.Font.caption(.semibold)],
                for: .selected
            )
            segment.addAction(UIAction { [weak segment] _ in
                guard let s = segment else { return }
                onChange(s.selectedSegmentIndex)
            }, for: .valueChanged)
            cell.contentView.addSubview(segment)
            NSLayoutConstraint.activate([
                segment.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                segment.centerYAnchor.constraint(equalTo: cell.contentView.centerYAnchor),
                segment.widthAnchor.constraint(equalToConstant: 140),
            ])
        }

        return cell
    }
}

// MARK: - Swift mirror of the Rust `Profile` enum

/// Mirrors `src-tauri/src/types.rs::Profile` for JSON round-tripping
/// through `record_account_ffi` / `derive_password_ffi`. Stays in the
/// extension target only — the Rust side remains canonical.
enum AutofillProfile {
    case random(RandomParams)
    case memorable(MemorableParams)

    var isRandom: Bool {
        if case .random = self { return true } else { return false }
    }

    static func defaultRandom() -> AutofillProfile {
        .random(RandomParams(length: 16, lower: true, upper: true, digits: true, symbols: true, counter: 1))
    }

    static func defaultMemorable() -> AutofillProfile {
        .memorable(MemorableParams(wordCount: 6, separator: .dot, capitalise: true, suffix: true, counter: 1))
    }

    func toJSON() -> String {
        let dict: [String: Any]
        switch self {
        case .random(let p):
            dict = [
                "mode": "random",
                "length": p.length,
                "lower": p.lower,
                "upper": p.upper,
                "digits": p.digits,
                "symbols": p.symbols,
                "counter": p.counter,
            ]
        case .memorable(let p):
            dict = [
                "mode": "memorable",
                "wordCount": p.wordCount,
                "separator": p.separator.rawValue,
                "capitalise": p.capitalise,
                "suffix": p.suffix,
                "counter": p.counter,
            ]
        }
        let data = (try? JSONSerialization.data(withJSONObject: dict, options: [])) ?? Data()
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

struct RandomParams {
    var length: UInt32
    var lower: Bool
    var upper: Bool
    var digits: Bool
    var symbols: Bool
    var counter: UInt32
}

struct MemorableParams {
    var wordCount: UInt32
    var separator: MemorableSeparator
    var capitalise: Bool
    var suffix: Bool
    var counter: UInt32
}

enum MemorableSeparator: String {
    case dash = "-"
    case dot = "."
    case underscore = "_"

    var pickerIndex: Int {
        switch self {
        case .dash: return 0
        case .dot: return 1
        case .underscore: return 2
        }
    }

    static func fromPickerIndex(_ idx: Int) -> MemorableSeparator {
        switch idx {
        case 0: return .dash
        case 2: return .underscore
        default: return .dot
        }
    }
}
