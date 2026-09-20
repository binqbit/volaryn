fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", volaryn_backend::http::openapi().to_pretty_json()?);
    Ok(())
}
