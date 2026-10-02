//! Build script that runs Neon's setup for the native Node.js module.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/");

    neon_build::setup();
}
