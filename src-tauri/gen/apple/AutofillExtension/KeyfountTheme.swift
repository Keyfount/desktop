import UIKit

/// Design tokens mirrored from `src/theme.css` (Tailwind v4 `@theme`
/// block). Source of truth for visual styling across the AutoFill
/// extension so the chooser feels like a continuation of the main
/// Preact app, not a generic iOS sheet.
///
/// OKLCH source values are converted to sRGB approximations — the
/// extension target doesn't compile Color.js, and stock UIKit doesn't
/// speak OKLCH. The light/dark pairs are bound through
/// `UIColor(dynamicProvider:)` so iOS swaps them when the system
/// appearance flips. Re-check these conversions if `theme.css` ever
/// changes hues.
enum KeyfountTheme {

    // MARK: - Colour palette

    /// Primary text colour (`--color-ink`). Near-black, faint cool tint.
    static let ink = dynamic(light: 0x1F1F23, dark: 0xF1F1F4)
    /// Body / secondary text (`--color-ink-muted`).
    static let inkMuted = dynamic(light: 0x5E5E63, dark: 0x9E9EA5)
    /// Tertiary text — labels, hints (`--color-ink-subtle`).
    static let inkSubtle = dynamic(light: 0x7E7E84, dark: 0x6A6A70)

    /// Page background (`--color-surface`).
    static let surface = dynamic(light: 0xFAFAFD, dark: 0x0C0C11)
    /// Card / row background (`--color-surface-elev`).
    static let surfaceElev = dynamic(light: 0xFFFFFF, dark: 0x15151D)
    /// Sunken background for sections / pressed states (`--color-surface-sunken`).
    static let surfaceSunken = dynamic(light: 0xF4F4F7, dark: 0x08080D)

    /// Hairline borders on cards and rows (`--color-line`).
    static let line = dynamic(light: 0xD6D6DB, dark: 0x2A2A33)
    /// Stronger hairline for hover / focus (`--color-line-strong`).
    static let lineStrong = dynamic(light: 0xA7A7AD, dark: 0x4A4A53)

    /// Accent — desaturated electric blue (`--color-accent-500`).
    static let accent = dynamic(light: 0x3B6EA5, dark: 0x9FB6D5)
    /// Accent at 12% alpha — used as focus / pressed background.
    static let accentSoft = dynamic(light: 0x3B6EA5, dark: 0x9FB6D5).withAlphaComponent(0.12)

    // MARK: - Semantic helpers

    /// Primary pill button background — dark ink on light surface, inverts in dark mode.
    static let primaryButtonBackground = ink
    static let primaryButtonForeground = surface
    static let secondaryButtonBackground = accentSoft
    static let secondaryButtonForeground = accent

    static let dangerText = dynamic(light: 0xC02525, dark: 0xFF7373)

    // MARK: - Typography

    enum Font {
        /// Body text — matches Preact `text-sm` (14px).
        static func body(_ weight: UIFont.Weight = .regular) -> UIFont {
            font(size: 14, weight: weight, mono: false)
        }
        /// Slightly larger body, 15px — used in `TopBar` and account rows.
        static func bodyLarge(_ weight: UIFont.Weight = .regular) -> UIFont {
            font(size: 15, weight: weight, mono: false)
        }
        /// Caption — 12px medium, used in chips and metadata.
        static func caption(_ weight: UIFont.Weight = .medium) -> UIFont {
            font(size: 12, weight: weight, mono: false)
        }
        /// Section title — 17px semibold, like sheet headers.
        static func title() -> UIFont {
            font(size: 17, weight: .semibold, mono: false)
        }
        /// Large title — lock-screen heading (~22px).
        static func largeTitle() -> UIFont {
            font(size: 22, weight: .semibold, mono: false)
        }
        /// Field label — 10px uppercased mono, the `field-label` from theme.css.
        static func fieldLabel() -> UIFont {
            font(size: 10, weight: .medium, mono: true)
        }
        /// Monospaced password display — 16px regular.
        static func mono(_ size: CGFloat = 16) -> UIFont {
            font(size: size, weight: .regular, mono: true)
        }

        /// Resolve "Geist Variable" / "Geist Mono Variable" if bundled
        /// (font file ships with the extension as a TTF / OTF — see
        /// `KeyfountTheme.bundledFontNames`). Otherwise fall back to
        /// the iOS system font, which is also a clean sans-serif and
        /// won't look out of place.
        private static func font(size: CGFloat, weight: UIFont.Weight, mono: Bool) -> UIFont {
            let family = mono ? bundledMonoName : bundledSansName
            if let family,
               let f = UIFont(name: weightedPostscriptName(family: family, weight: weight), size: size) {
                return f
            }
            return mono
                ? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
                : UIFont.systemFont(ofSize: size, weight: weight)
        }

        /// Suffix-map UIFont.Weight to a PostScript weight token. Geist
        /// Variable uses "Geist-Regular", "Geist-Medium", "Geist-Semibold".
        private static func weightedPostscriptName(family: String, weight: UIFont.Weight) -> String {
            let suffix: String
            switch weight {
            case .regular: suffix = "Regular"
            case .medium: suffix = "Medium"
            case .semibold: suffix = "Semibold"
            case .bold: suffix = "Bold"
            default: suffix = "Regular"
            }
            return "\(family)-\(suffix)"
        }

        /// Set by `KeyfountTheme.registerBundledFonts()` when the
        /// resource files load successfully. Nil otherwise — the
        /// system fallback covers that case.
        fileprivate static var bundledSansName: String?
        fileprivate static var bundledMonoName: String?
    }

    // MARK: - Spacing & radii

    enum Radius {
        /// Pill — used on buttons, chips, inputs. Theme.css = `rounded-full`.
        static let pill: CGFloat = 999
        /// Standard card / row corner. Theme.css = `rounded-2xl` (16px).
        static let card: CGFloat = 16
        /// Tighter corner, for nested chips or small surfaces. `rounded-xl` (12px).
        static let small: CGFloat = 12
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    // MARK: - Font registration

    /// Register Geist + Geist Mono if their `.ttf` files are bundled in
    /// the extension's resources. Safe to call multiple times — the
    /// `CTFontManager` API is idempotent on already-loaded files.
    static func registerBundledFonts() {
        Font.bundledSansName = registerVariableFont(named: "Geist-Variable", fallbackFamily: "Geist")
        Font.bundledMonoName = registerVariableFont(named: "GeistMono-Variable", fallbackFamily: "Geist Mono")
    }

    private static func registerVariableFont(named base: String, fallbackFamily: String) -> String? {
        guard let url = Bundle.main.url(forResource: base, withExtension: "ttf"),
              let dataProvider = CGDataProvider(url: url as CFURL),
              let font = CGFont(dataProvider) else {
            return nil
        }
        var error: Unmanaged<CFError>?
        // Already-registered files raise an error code we can ignore.
        _ = CTFontManagerRegisterGraphicsFont(font, &error)
        return font.postScriptName as String? ?? fallbackFamily
    }

    // MARK: - Helpers

    /// Bind a (lightHex, darkHex) pair to a dynamic `UIColor` that
    /// follows the system appearance — matches Tailwind's
    /// `@media (prefers-color-scheme: dark)` behaviour from
    /// `theme.css`.
    private static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(rgb: dark)
                : UIColor(rgb: light)
        }
    }
}

// MARK: - UIColor convenience

extension UIColor {
    /// 0xRRGGBB-style hex initialiser. Alpha defaults to 1.
    convenience init(rgb: UInt32, alpha: CGFloat = 1.0) {
        let r = CGFloat((rgb >> 16) & 0xFF) / 255.0
        let g = CGFloat((rgb >> 8) & 0xFF) / 255.0
        let b = CGFloat(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b, alpha: alpha)
    }
}
