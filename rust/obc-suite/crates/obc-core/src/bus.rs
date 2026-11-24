//! Bidirectional simulator control bus (`/obc/cmd`) and universal `__bh` / TARS RPC client.
//!
//! RPC over 9p is keyed by request id (`src/obc/bridge.ts`, docs/PLAN-LINUX-OBC.md §2.1): the request is written to
//! `/obc/rpc/<id>.req`, the reply read from `/obc/rpc/<id>.res` (then removed). The single slot `/obc/rpc_res`, which
//! the host also writes, is the fallback; `/obc/rpc_req` is used only when the host has no `/obc/rpc` directory (an
//! older host). Ids are `rs-<pid>-<nonce>-<seq>`: unique across concurrent Rust apps, not only within one process.

use crate::telemetry::{TELEMETRY_PATH, Telemetry};
use serde_json::{Value, json};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const CMD_PATH: &str = "/obc/cmd";
pub const RPC_REQ_PATH: &str = "/obc/rpc_req";
pub const RPC_RES_PATH: &str = "/obc/rpc_res";
/// Keyed RPC directory: `<id>.req` written by the guest, `<id>.res` written by the host.
pub const RPC_DIR: &str = "/obc/rpc";

static RPC_SEQ: AtomicU64 = AtomicU64::new(1);
static RPC_NONCE: OnceLock<u32> = OnceLock::new();

/// A per-process random nonce (from `/dev/urandom`, else the clock mixed with the pid).
fn rpc_nonce() -> u32 {
    *RPC_NONCE.get_or_init(|| {
        let mut buf = [0u8; 4];
        if fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut buf))
            .is_ok()
        {
            return u32::from_le_bytes(buf);
        }
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let mixed = (nanos as u64) ^ (u64::from(std::process::id()) << 32);
        (mixed ^ (mixed >> 29)).wrapping_mul(0x9E37_79B9_7F4A_7C15) as u32
    })
}

/// The next RPC id of this process: `rs-<pid>-<nonce>-<seq>` (a safe file name, `[A-Za-z0-9_.-]`).
#[must_use]
pub fn next_rpc_id() -> String {
    format!(
        "rs-{}-{:08x}-{}",
        std::process::id(),
        rpc_nonce(),
        RPC_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// Parse one reply file's text, keeping it only when it answers `id`.
fn reply_for(raw: &str, id: &str) -> Option<Value> {
    let v = serde_json::from_str::<Value>(raw.trim()).ok()?;
    (v.get("id").and_then(Value::as_str) == Some(id)).then_some(v)
}

/// Rich metadata for a live `__bh` member returned by `op: "ls"` or `op: "catalog"`.
#[derive(Debug, Clone)]
pub struct BhMember {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub preview: String,
    pub arity: Option<usize>,
    pub fn_params: Vec<String>,
}

/// Typed schema specification for one parameter of a TARS tool.
#[derive(Debug, Clone)]
pub struct TarsParamSpec {
    pub name: String,
    pub kind: String,
    pub required: bool,
    pub description: String,
    pub choices: Vec<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub integer: bool,
}

/// Complete specification of a TARS tool (name, description, parameters & typed schemas).
#[derive(Debug, Clone)]
pub struct TarsToolInfo {
    pub name: String,
    pub description: String,
    pub params: Vec<String>,
    pub required: Vec<String>,
    pub param_specs: Vec<TarsParamSpec>,
}

/// Complete searchable catalog of `__bh` members and TARS tools for instant fuzzy search.
#[derive(Debug, Clone, Default)]
pub struct BhCatalog {
    pub members: Vec<BhMember>,
    pub tools: Vec<TarsToolInfo>,
}

#[derive(Debug, Default)]
pub struct AvionicsBus {
    last_tel: Telemetry,
}

fn parse_str_array(val: Option<&Value>) -> Vec<String> {
    val.and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_bh_member(item: &Value, parent_path: &str) -> Option<BhMember> {
    let raw_path = item.get("path").and_then(Value::as_str);
    let raw_name = item.get("name").and_then(Value::as_str);
    let (name, path) = match (raw_name, raw_path) {
        (Some(n), Some(p)) => (n.to_string(), p.to_string()),
        (Some(n), None) => {
            let p = if parent_path.is_empty() {
                n.to_string()
            } else {
                format!("{parent_path}.{n}")
            };
            (n.to_string(), p)
        }
        (None, Some(p)) => {
            let n = p.rsplit('.').next().unwrap_or(p).to_string();
            (n, p.to_string())
        }
        (None, None) => return None,
    };
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
    let arity = item
        .get("arity")
        .and_then(Value::as_u64)
        .and_then(|n| usize::try_from(n).ok());
    let fn_params = parse_str_array(item.get("fnParams"));
    Some(BhMember {
        name,
        path,
        kind,
        preview,
        arity,
        fn_params,
    })
}

fn parse_tars_tool(item: &Value) -> Option<TarsToolInfo> {
    let name = item.get("name")?.as_str()?.to_string();
    let description = item
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let params = parse_str_array(item.get("params"));
    let required = parse_str_array(item.get("required"));
    let mut param_specs: Vec<TarsParamSpec> = item
        .get("paramSpecs")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|ps| {
                    let pname = ps.get("name")?.as_str()?.to_string();
                    let kind = ps
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("string")
                        .to_string();
                    let req = ps.get("required").and_then(Value::as_bool).unwrap_or(false);
                    let desc = ps
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let choices = parse_str_array(ps.get("enum"));
                    let min = ps.get("min").and_then(Value::as_f64);
                    let max = ps.get("max").and_then(Value::as_f64);
                    let integer = ps.get("integer").and_then(Value::as_bool).unwrap_or(false);
                    Some(TarsParamSpec {
                        name: pname,
                        kind,
                        required: req,
                        description: desc,
                        choices,
                        min,
                        max,
                        integer,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if param_specs.is_empty() && !params.is_empty() {
        param_specs = params
            .iter()
            .map(|p| TarsParamSpec {
                name: p.clone(),
                kind: "string".into(),
                required: required.contains(p),
                description: String::new(),
                choices: Vec::new(),
                min: None,
                max: None,
                integer: false,
            })
            .collect();
    }
    Some(TarsToolInfo {
        name,
        description,
        params,
        required,
        param_specs,
    })
}

fn unwrap_rpc_result(res: Option<Value>) -> Result<Value, String> {
    let Some(v) = res else {
        return Err("RPC timeout or bridge unavailable".into());
    };
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    } else {
        let msg = v
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("unknown RPC error")
            .to_string();
        Err(msg)
    }
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

    /// Synchronous RPC call to the host's `src/obc/bh-rpc.ts` over 9p (keyed `/obc/rpc/<id>.req` -> `<id>.res`,
    /// falling back to the single slot `/obc/rpc_req` -> `/obc/rpc_res` on an older host).
    #[must_use]
    pub fn rpc(&self, mut req: Value, timeout_ms: u64) -> Option<Value> {
        let id = next_rpc_id();
        if let Some(obj) = req.as_object_mut() {
            obj.insert("id".into(), Value::String(id.clone()));
        }
        let Ok(mut body) = serde_json::to_string(&req) else {
            return None;
        };
        body.push('\n');
        let req_path = format!("{RPC_DIR}/{id}.req");
        let res_path = format!("{RPC_DIR}/{id}.res");
        let keyed = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&req_path)
            .and_then(|mut f| f.write_all(body.as_bytes()))
            .is_ok();
        if !keyed && fs::write(RPC_REQ_PATH, body.as_bytes()).is_err() {
            return None;
        }
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if keyed
                && let Ok(raw) = fs::read_to_string(&res_path)
                && let Some(v) = reply_for(&raw, &id)
            {
                let _ = fs::remove_file(&res_path);
                return Some(v);
            }
            if let Ok(raw) = fs::read_to_string(RPC_RES_PATH)
                && let Some(v) = reply_for(&raw, &id)
            {
                if keyed {
                    let _ = fs::remove_file(&res_path);
                }
                return Some(v);
            }
            if Instant::now() >= deadline {
                if keyed {
                    let _ = fs::remove_file(&req_path);
                }
                return None;
            }
            thread::sleep(Duration::from_millis(12));
        }
    }

    /// List `__bh` members at `path` (empty for root) with full metadata (`fnParams`, `arity`).
    #[must_use]
    pub fn bh_ls_rich(&self, path: &str) -> Vec<BhMember> {
        let Some(res) = self.rpc(json!({ "op": "ls", "path": path }), 1800) else {
            return Vec::new();
        };
        let Some(arr) = res.get("result").and_then(Value::as_array) else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|item| parse_bh_member(item, path))
            .collect()
    }

    /// List `__bh` members at `path` as compact `(name, kind, preview)` tuples.
    #[must_use]
    pub fn bh_ls(&self, path: &str) -> Vec<(String, String, String)> {
        self.bh_ls_rich(path)
            .into_iter()
            .map(|m| (m.name, m.kind, m.preview))
            .collect()
    }

    /// Fetch the complete searchable catalog of `__bh` members and TARS tools in one RPC call.
    #[must_use]
    pub fn bh_catalog(&self) -> BhCatalog {
        let Some(res) = self.rpc(json!({ "op": "catalog" }), 3000) else {
            return BhCatalog::default();
        };
        let Some(obj) = res.get("result").and_then(Value::as_object) else {
            return BhCatalog::default();
        };
        let members = obj
            .get("members")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| parse_bh_member(item, ""))
                    .collect()
            })
            .unwrap_or_default();
        let tools = obj
            .get("tools")
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(parse_tars_tool).collect())
            .unwrap_or_default();
        BhCatalog { members, tools }
    }

    /// Read a `__bh` property value by dotted path.
    #[must_use]
    pub fn bh_get(&self, path: &str) -> Option<Value> {
        self.bh_get_result(path).ok()
    }

    /// Read a `__bh` property value by dotted path, returning any host error message.
    ///
    /// # Errors
    /// Returns an error string on RPC timeout or host failure.
    pub fn bh_get_result(&self, path: &str) -> Result<Value, String> {
        unwrap_rpc_result(self.rpc(json!({ "op": "get", "path": path }), 1800))
    }

    /// Set a `__bh` property value by dotted path (auto-refreshes `settings.*`).
    ///
    /// # Errors
    /// Returns an error string on RPC timeout or host failure.
    pub fn bh_set_result(&self, path: &str, value: &Value) -> Result<Value, String> {
        unwrap_rpc_result(self.rpc(
            json!({ "op": "set", "path": path, "value": value, "refresh": true }),
            2000,
        ))
    }

    /// Invoke a `__bh` method by dotted path.
    #[must_use]
    pub fn bh_call(&self, path: &str, args: &Value) -> Option<Value> {
        self.bh_call_result(path, args).ok()
    }

    /// Invoke a `__bh` method by dotted path, returning the result or exact error message.
    ///
    /// # Errors
    /// Returns an error string on RPC timeout or host failure.
    pub fn bh_call_result(&self, path: &str, args: &Value) -> Result<Value, String> {
        unwrap_rpc_result(self.rpc(json!({ "op": "call", "path": path, "args": args }), 4000))
    }

    /// Evaluate a CSP-safe `__bh` expression (chains, method calls, assignments).
    ///
    /// # Errors
    /// Returns an error string on RPC timeout or host evaluation error.
    pub fn bh_eval_result(&self, expr: &str) -> Result<Value, String> {
        unwrap_rpc_result(self.rpc(json!({ "op": "eval", "expr": expr }), 4000))
    }

    /// List all TARS tools with full typed parameter schemas.
    #[must_use]
    pub fn tars_tools_rich(&self) -> Vec<TarsToolInfo> {
        let Some(res) = self.rpc(json!({ "op": "tools" }), 2500) else {
            return Vec::new();
        };
        let Some(arr) = res.get("result").and_then(Value::as_array) else {
            return Vec::new();
        };
        arr.iter().filter_map(parse_tars_tool).collect()
    }

    /// List all TARS tools (`name`, `description`, `params`).
    #[must_use]
    pub fn tars_tools(&self) -> Vec<(String, String, Vec<String>)> {
        self.tars_tools_rich()
            .into_iter()
            .map(|t| (t.name, t.description, t.params))
            .collect()
    }

    /// Execute a TARS tool by name with JSON arguments.
    #[must_use]
    pub fn tars_tool(&self, name: &str, args: &Value) -> Option<Value> {
        self.tars_tool_result(name, args).ok()
    }

    /// Execute a TARS tool by name with JSON arguments, returning result or schema/runtime error.
    ///
    /// # Errors
    /// Returns an error string on RPC timeout, invalid args, or tool failure.
    pub fn tars_tool_result(&self, name: &str, args: &Value) -> Result<Value, String> {
        unwrap_rpc_result(self.rpc(
            json!({ "op": "tool", "name": name, "toolArgs": args }),
            5000,
        ))
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
        unwrap_rpc_result(self.rpc(req, 1800)).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_ids_are_unique_safe_file_names_with_pid_and_nonce() {
        let a = next_rpc_id();
        let b = next_rpc_id();
        assert_ne!(a, b);
        let pid = std::process::id().to_string();
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(parts.len(), 4, "{a}");
        assert_eq!(parts[0], "rs");
        assert_eq!(parts[1], pid);
        assert_eq!(parts[2].len(), 8);
        assert!(u32::from_str_radix(parts[2], 16).is_ok());
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        );
        assert!(a.len() <= 96);
    }

    #[test]
    fn reply_for_keeps_only_the_matching_id() {
        assert!(reply_for(r#"{"id":"rs-1-a-1","ok":true}"#, "rs-1-a-1").is_some());
        assert!(reply_for(r#"{"id":"rs-2-b-1","ok":true}"#, "rs-1-a-1").is_none());
        assert!(reply_for("garbage", "rs-1-a-1").is_none());
        assert!(reply_for("{\"id\":\"x\",\"ok\":true}\n   ", "x").is_some());
    }
}
