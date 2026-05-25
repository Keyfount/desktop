//! Menu-bar / system-tray icon.
//!
//! On macOS the icon sits in the menu bar and a click toggles the popover.
//! On Windows it sits in the system tray. The context menu exposes the
//! same quick actions everywhere (Unlock / Lock, Quick Search, Open
//! Preferences, Quit).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let quick_search = MenuItem::with_id(app, "quick-search", "Quick search", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "preferences", "Preferences…", true, None::<&str>)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Keyfount", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quick_search, &preferences, &separator, &quit])?;

    let _tray = TrayIconBuilder::with_id("keyfount-tray")
        .menu(&menu)
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::Anyhow(anyhow::anyhow!("no default window icon configured"))
        })?)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quick-search" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "preferences" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                    let _ = win.eval("window.location.hash = '#/settings';");
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                if matches!(button, tauri::tray::MouseButton::Left) {
                    if let Some(win) = tray.app_handle().get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}
