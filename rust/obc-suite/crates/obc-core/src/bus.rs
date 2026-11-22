//! Bidirectional simulator control bus (`/obc/cmd`) and universal `__bh` / TARS RPC client
//! (`/obc/rpc_req` -> `/obc/rpc_res`).

use crate::telemetry::{TELEMETRY_PATH, Telemetry};
use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

pub const CMD_PATH: &str = "/obc/cmd";
pub const RPC_REQ_PATH: &str = "/obc/rpc_req";
pub const RPC_RES_PATH: &str = "/obc/rpc_res";

static RPC_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Default)]
pub struct AvionicsBus {
    last_tel: Telemetry,
}

impl AvionicsBus {
    #[must_use]
    pub fn new() -> Self {
        Self {
            last_tel: Telemetry::default(),
        }
    }

    /// Read fresh telemetry from `/obc/telemetry.json`, keeping the last valid frame on transient errors.
    pub fn telemetry(&mut self) -> &Telemetry {
        self.last_tel = Telemetry::read_or_keep(TELEMETRY_PATH, &self.last_tel);
        &self.last_tel
    }

    /// Last cached telemetry without touching the filesystem.
    #[must_use]
    pub const fn cached(&self) -> &Telemetry {
        &self.last_tel
    }

    /// Send a validated JSONL avionics command to `/obc/cmd`.
    pub fn send_cmd(&self, payload: &Value) -> bool {
        let Ok(mut line) = serde_json::to_string(payload) else {
            return false;
        };
        line.push('\n');
        OpenOptions::new()
            .write(true)
            .open(CMD_PATH)
            .and_then(|mut f| f.write_all(line.as_bytes()))
            .is_ok()
    }

    pub fn set_throttle(&self, value: f64) -> bool {
        self.send_cmd(&json!({ "kind": "throttle", "value": value.clamp(0.0, 1.0) }))
    }

    pub fn set_sas(&self, on: bool) -> bool {
        self.send_cmd(&json!({ "kind": "sas", "on": on }))
    }

    pub fn set_gear(&self, down: bool) -> bool {
        self.send_cmd(&json!({ "kind": "gear", "down": down }))
    }

    pub fn set_flaps(&self, value: f64) -> bool {
        self.send_cmd(&json!({ "kind": "flaps", "value": value.clamp(0.0, 1.0) }))
    }

    pub fn set_autopilot(&self, mode: &str) -> bool {
        self.send_cmd(&json!({ "kind": "autopilot", "mode": mode }))
    }

    pub fn set_hold(&self, mode: &str) -> bool {
        self.send_cmd(&json!({ "kind": "hold", "mode": mode }))
    }

    /// Synchronous RPC call to the host's `src/obc/bh-rpc.ts` over 9p (`/obc/rpc_req` -> `/obc/rpc_res`).
    #[must_use]
    pub fn rpc(&self, mut req: Value, timeout_ms: u64) -> Option<Value> {
        let id = format!("rs-{}", RPC_SEQ.fetch_add(1, Ordering::Relaxed));
        if let Some(obj) = req.as_object_mut() {
            obj.insert("id".into(), Value::String(id.clone()));
        }
        let Ok(mut body) = serde_json::to_string(&req) else {
            return None;
        };
        body.push('\n');
        if fs::write(RPC_REQ_PATH, body.as_bytes()).is_err() {
            return None;
        }
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if let Ok(raw) = fs::read_to_string(RPC_RES_PATH) {
                let trimmed = raw.trim();
                if let Ok(v) = serde_json::from_str::<Value>(trimmed)
                    && v.get("id").and_then(Value::as_str) == Some(id.as_str())
                {
                    return Some(v);
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(12));
        }
    }

    /// List `__bh` members at `path` (empty for root).
    #[must_use]
    pub fn bh_ls(&self, path: &str) -> Vec<(String, String, String)> {
        let Some(res) = self.rpc(json!({ "op": "ls", "path": path }), 1500) else {
            return Vec::new();
        };
        let Some(arr) = res.get("result").and_then(Value::as_array) else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_string();
                let kind = item
                    .get("kind")
                    .or_else(|| item.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let preview = item
                    .get("preview")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                Some((name, kind, preview))
            })
            .collect()
    }

    /// Read a `__bh` property value by dotted path.
    #[must_use]
    pub fn bh_get(&self, path: &str) -> Option<Value> {
        let res = self.rpc(json!({ "op": "get", "path": path }), 1500)?;
        if res.get("ok").and_then(Value::as_bool) == Some(true) {
            res.get("result").cloned()
        } else {
            None
        }
    }

    /// Invoke a `__bh` method by dotted path.
    #[must_use]
    pub fn bh_call(&self, path: &str, args: &Value) -> Option<Value> {
        let res = self.rpc(json!({ "op": "call", "path": path, "args": args }), 2000)?;
        if res.get("ok").and_then(Value::as_bool) == Some(true) {
            res.get("result").cloned()
        } else {
            None
        }
    }

    /// List all TARS tools (`name`, `description`, `params`).
    #[must_use]
    pub fn tars_tools(&self) -> Vec<(String, String, Vec<String>)> {
        let Some(res) = self.rpc(json!({ "op": "tools" }), 2000) else {
            return Vec::new();
        };
        let Some(arr) = res.get("result").and_then(Value::as_array) else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|item| {
                let name = item.get("name")?.as_str()?.to_string();
                let desc = item
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let params = item
                    .get("params")
                    .and_then(Value::as_array)
                    .map(|p| {
                        p.iter()
                            .filter_map(Value::as_str)
                            .map(ToString::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                Some((name, desc, params))
            })
            .collect()
    }

    /// Execute a TARS tool by name with JSON arguments.
    #[must_use]
    pub fn tars_tool(&self, name: &str, args: &Value) -> Option<Value> {
        let res = self.rpc(json!({ "op": "tool", "name": name, "toolArgs": args }), 3000)?;
        if res.get("ok").and_then(Value::as_bool) == Some(true) {
            res.get("result").cloned()
        } else {
            None
        }
    }

    /// Control or read the A320 Captain MCDU / Lower ECAM via dedicated `op: "mcdu"`.
    #[must_use]
    pub fn mcdu(&self, action: &str, arg: Option<&str>) -> Option<Value> {
        let req = match (action, arg) {
            ("page", Some(p)) => json!({ "op": "mcdu", "action": "page", "page": p }),
            ("ecam", Some(e)) => json!({ "op": "mcdu", "action": "ecam", "ecam": e }),
            ("type", Some(t)) => json!({ "op": "mcdu", "action": "type", "text": t }),
            (_, Some(v)) => json!({ "op": "mcdu", "action": action, "page": v }),
            (_, None) => json!({ "op": "mcdu", "action": action }),
        };
        let res = self.rpc(req, 1500)?;
        if res.get("ok").and_then(Value::as_bool) == Some(true) {
            res.get("result").cloned()
        } else {
            None
        }
    }
}
