//! Builds libprojectM (the Milkdrop visualiser, LGPL-2.1) from the source in
//! third_party/libprojectM and links it statically, for OpenGL ES 3, the API
//! the plugin's offscreen renderer uses. Nothing needs installing but the
//! usual C and C++ compilers, cmake and the OpenGL ES library.

use std::path::PathBuf;

fn main() {
    let source = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../third_party/libprojectM");
    println!("cargo:rerun-if-changed={}", source.join("CMakeLists.txt").display());
    let out = cmake::Config::new(&source)
        .define("ENABLE_GLES", "ON")
        .define("BUILD_SHARED_LIBS", "OFF")
        .define("ENABLE_PLAYLIST", "OFF")
        .define("ENABLE_SDL_UI", "OFF")
        .define("BUILD_TESTING", "OFF")
        .define("BUILD_DOCS", "OFF")
        .define("ENABLE_SYSTEM_GLM", "OFF")
        .define("ENABLE_SYSTEM_PROJECTM_EVAL", "OFF")
        .define("ENABLE_DEBUG_POSTFIX", "OFF")
        .define("CMAKE_INSTALL_LIBDIR", "lib")
        .profile("Release")
        .build();
    println!("cargo:rustc-link-search=native={}", out.join("lib").display());
    // the expression evaluator the presets are written in, built alongside
    println!("cargo:rustc-link-search=native={}", out.join("build/vendor/projectm-eval/projectm-eval").display());
    println!("cargo:rustc-link-lib=static=projectM-4");
    println!("cargo:rustc-link-lib=static=projectM_eval");
    println!("cargo:rustc-link-lib=dylib=stdc++");
    println!("cargo:rustc-link-lib=dylib=GLESv2");
}
