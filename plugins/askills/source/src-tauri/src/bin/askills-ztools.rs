fn main() {
    if let Err(error) = askills_lib::run_ztools_helper() {
        eprintln!("Askills helper: {error}");
        std::process::exit(1);
    }
}
