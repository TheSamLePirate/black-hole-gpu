//! Six AAA real-time `/dev/fb0` graphical avionics displays written in pure zero-allocation Rust:
//! - `pfd`: Primary Flight Display (1:1 artificial horizon matching `src/a320/du/pfd.ts`)
//! - `f35`: F-35B/C TSD & AN/APG-81 tactical radar
//! - `a320`: Airbus A320 ARC-mode Navigation Display + route + TCAS
//! - `ils`: Split Plan View + 3° Glidepath Profile + LOC/GS diamonds
//! - `radar`: Orbital & tactical phosphor radar scope
//! - `kerr`: Gargantua relativistic Kerr spacetime accretion disk & potential well

pub mod a320;
pub mod f35;
pub mod ils;
pub mod kerr;
pub mod pfd;
pub mod radar;

/// Common CLI options parsed from `--seconds N`.
#[derive(Debug, Clone, Copy, Default)]
pub struct FbRunOpts {
    pub seconds: Option<f64>,
}

impl FbRunOpts {
    #[must_use]
    pub fn from_args(args: &[String]) -> Self {
        let mut seconds = None;
        let mut i = 0;
        while i < args.len() {
            if args[i] == "--seconds"
                && let Some(v) = args.get(i + 1).and_then(|s| s.parse::<f64>().ok())
                && v > 0.0
            {
                seconds = Some(v);
                i += 2;
                continue;
            }
            i += 1;
        }
        Self { seconds }
    }
}
