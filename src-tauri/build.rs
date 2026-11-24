fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        // `tauri_build::build()` already embeds a manifest via `resource.lib` for binary targets;
        // suppress the linker-generated manifest on bins to avoid CVT1100 duplicate MANIFEST.
        println!("cargo:rustc-link-arg-bins=/MANIFEST:NO");
    }
}
