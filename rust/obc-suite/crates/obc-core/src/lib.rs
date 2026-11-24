//! Core avionics telemetry, universal `__bh` RPC bus, WGS84 geodesy, Kerr metric physics,
//! zero-allocation `/dev/fb0` XRGB8888 renderer, and non-blocking POSIX TTY key input.

pub mod bus;
pub mod fb;
pub mod geo;
pub mod telemetry;
pub mod units;

pub use bus::{AvionicsBus, BhCatalog, BhMember, TarsParamSpec, TarsToolInfo};
pub use fb::{Framebuffer, RawKey, RawKeyReader, rgb};
pub use geo::{Airport, KerrMetrics, WORLD_AIRPORTS, kerr_metrics, wgs84_bearing_dist};
pub use telemetry::{Attitude, Flight, Nav, Orbit, Position, RunwayNav, Systems, Telemetry};
pub use units::{NM_M, UnitSys};
