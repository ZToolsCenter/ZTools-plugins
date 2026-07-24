use neon::prelude::*;

mod everything;
mod file_tree;
mod js_args;
mod text_preview;

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    everything::export(&mut cx)?;
    file_tree::export(&mut cx)?;
    text_preview::export(&mut cx)?;
    Ok(())
}
