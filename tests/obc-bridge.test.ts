// The OBC RPC channel (src/obc/bridge.ts): keyed 9p request/response files so concurrent guest programs never read
// each other's replies, the legacy single slot kept as fallback, and bounded JSONL lines on AF_VSOCK (an oversize line
// is answered with E2BIG and skipped up to its newline instead of leaving its tail to be parsed as a request).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { MemoryFs, type Vsock, type VsockConnection } from "unkernel/web";
import {
  isSafeRpcId,
  JsonlLineSplitter,
  OBC_RPC_MAX_LINE,
  OBC_RPC_RES_MAX,
  startObcVsockServer,
  wireObcMountFs,
  type ObcHostAdapter,
  type ObcMountHandle,
} from "../src/obc/bridge";
import { emptyTelemetry } from "../src/obc/protocol";

const g = globalThis as unknown as { __bh?: Record<string, unknown> };
let prevBh: Record<string, unknown> | undefined;
let handle: ObcMountHandle | null = null;

const adapter: ObcHostAdapter = {
  sampleTelemetry: emptyTelemetry,
  executeCommand: () => ({ ok: true, msg: "done" }),
};

beforeEach(() => {
  prevBh = g.__bh;
  // Two TARS tools: one answers at once, one after a delay (an async reply that lands after a later sync one).
  g.__bh = {
    tars: {
      tools: () => [
        { name: "fast", description: "sync", params: {}, required: [], run: () => "fast-result" },
        {
          name: "slow",
          description: "async",
          params: {},
          required: [],
          run: () => new Promise((r) => setTimeout(() => r("slow-result"), 40)),
        },
      ],
    },
  };
});

afterEach(() => {
  handle?.dispose();
  handle = null;
  g.__bh = prevBh;
});

const enc = new TextEncoder();

/** Write a file the way the guest does (through the Fs interface, so onChange fires), in `chunks` 9p writes. */
async function guestWrite(mem: MemoryFs, path: string, text: string, chunks = 1): Promise<void> {
  const bytes = enc.encode(text);
  const f = await mem.create(path, 0o644);
  const step = Math.ceil(bytes.byteLength / chunks);
  for (let off = 0; off < bytes.byteLength; off += step) {
    await f.write?.(off, bytes.subarray(off, Math.min(bytes.byteLength, off + step)));
  }
}

function mount(): MemoryFs {
  const mem = new MemoryFs();
  handle = wireObcMountFs(
    mem,
    adapter,
    () => ({}) as never,
    {},
    {},
    () => {},
  );
  return mem;
}

const readJson = (mem: MemoryFs, path: string) => JSON.parse(mem.readText(path)) as Record<string, unknown>;

test("isSafeRpcId accepts the libraries' ids and refuses path tricks", () => {
  for (const id of ["rs-412-9f3a01bc-7", "py-88-0a1b2c3d-1", "js-1-deadbeef-12", "legacy_id.2"]) {
    expect(isSafeRpcId(id)).toBe(true);
  }
  for (const id of ["", ".hidden", "..", "a/b", "a..b", "x".repeat(97), "id with space", 42, null]) {
    expect(isSafeRpcId(id)).toBe(false);
  }
});

test("keyed 9p RPC: concurrent requests each get their own reply, an async reply never overwrites another's", async () => {
  const mem = mount();
  // The slow (async) request goes first, the fast (sync) one second: with a single /rpc_res slot the fast reply would
  // be overwritten 40 ms later and its client, polling for its id, would time out.
  await guestWrite(mem, "/rpc/rs-100-aaaaaaaa-1.req", `${JSON.stringify({ op: "tool", name: "slow", id: "x" })}\n`);
  await guestWrite(mem, "/rpc/py-200-bbbbbbbb-1.req", `${JSON.stringify({ op: "tool", name: "fast" })}\n`);
  // The sync reply is there at once, under the file's id, and the request files were taken.
  const fast = readJson(mem, "/rpc/py-200-bbbbbbbb-1.res");
  expect(fast).toMatchObject({ id: "py-200-bbbbbbbb-1", ok: true, result: "fast-result" });
  expect(mem.exists("/rpc/py-200-bbbbbbbb-1.req")).toBe(false);
  expect(mem.exists("/rpc/rs-100-aaaaaaaa-1.req")).toBe(false);
  expect(mem.exists("/rpc/rs-100-aaaaaaaa-1.res")).toBe(false);
  await new Promise((r) => setTimeout(r, 80));
  // The async reply landed in its own file (the body's "id" is overridden by the file's) …
  expect(readJson(mem, "/rpc/rs-100-aaaaaaaa-1.res")).toMatchObject({ id: "rs-100-aaaaaaaa-1", ok: true, result: "slow-result" });
  // … and the fast one is still readable: nothing was overwritten.
  expect(readJson(mem, "/rpc/py-200-bbbbbbbb-1.res")).toMatchObject({ id: "py-200-bbbbbbbb-1", result: "fast-result" });
  // The single slot holds the last reply (the fallback channel).
  expect(readJson(mem, "/rpc_res").id).toBe("rs-100-aaaaaaaa-1");
});

test("keyed 9p RPC: a request split over several 9p writes is taken only once complete", async () => {
  const mem = mount();
  const body = `${JSON.stringify({ op: "tool", name: "fast", pad: "p".repeat(20_000) })}\n`;
  await guestWrite(mem, "/rpc/js-1-cccccccc-1.req", body, 5);
  expect(readJson(mem, "/rpc/js-1-cccccccc-1.res")).toMatchObject({ id: "js-1-cccccccc-1", ok: true, result: "fast-result" });
});

test("keyed 9p RPC: an oversize request is refused with E2BIG, an unsafe id is dropped, legit traffic still passes", async () => {
  const mem = mount();
  await guestWrite(mem, "/rpc/rs-1-dddddddd-1.req", `{"op":"tool","pad":"${"z".repeat(OBC_RPC_MAX_LINE)}"}\n`, 64);
  const big = readJson(mem, "/rpc/rs-1-dddddddd-1.res");
  expect(big).toMatchObject({ id: "rs-1-dddddddd-1", ok: false, code: "E2BIG" });
  expect(mem.exists("/rpc/rs-1-dddddddd-1.req")).toBe(false);

  await guestWrite(mem, "/rpc/.sneaky.req", `${JSON.stringify({ op: "tool", name: "fast" })}\n`);
  expect(mem.exists("/rpc/.sneaky.req")).toBe(false);
  expect(mem.exists("/rpc/.sneaky.res")).toBe(false);

  await guestWrite(mem, "/rpc/rs-1-dddddddd-2.req", `${JSON.stringify({ op: "tool", name: "fast" })}\n`);
  expect(readJson(mem, "/rpc/rs-1-dddddddd-2.res")).toMatchObject({ ok: true, result: "fast-result" });
});

test("keyed 9p RPC: unread replies are swept beyond the cap", async () => {
  const mem = mount();
  for (let i = 0; i < OBC_RPC_RES_MAX + 12; i++) {
    await guestWrite(mem, `/rpc/js-9-eeeeeeee-${i}.req`, `${JSON.stringify({ op: "tool", name: "fast" })}\n`);
  }
  const left = mem.list("/rpc").filter((n) => n.endsWith(".res"));
  expect(left.length).toBeLessThanOrEqual(OBC_RPC_RES_MAX);
  expect(left).toContain(`js-9-eeeeeeee-${OBC_RPC_RES_MAX + 11}.res`);
  expect(left).not.toContain("js-9-eeeeeeee-0.res");
});

test("legacy single slot: still answered, and only once the line is complete", async () => {
  const mem = mount();
  const line = `${JSON.stringify({ op: "tool", name: "fast", id: "old-1" })}\n`;
  const f = await mem.open("/rpc_req", { read: false, write: true, truncate: true, append: false });
  await f.write?.(0, enc.encode(line.slice(0, 10)));
  expect(readJson(mem, "/rpc_res").id).toBe(0);
  await f.write?.(10, enc.encode(line.slice(10)));
  expect(readJson(mem, "/rpc_res")).toMatchObject({ id: "old-1", ok: true, result: "fast-result" });
  // Its reply is also published under the (safe) id.
  expect(readJson(mem, "/rpc/old-1.res")).toMatchObject({ id: "old-1", ok: true });
});

test("JsonlLineSplitter: lines across chunks, an oversize line reported once and its tail never parsed", () => {
  const s = new JsonlLineSplitter(16);
  expect(s.push('{"a":')).toEqual([]);
  expect(s.push('1}\n{"b":2}\n')).toEqual([{ line: '{"a":1}' }, { line: '{"b":2}' }]);
  // 40 characters without a newline: one overflow, then the rest of that line is skipped …
  expect(s.push("x".repeat(40))).toEqual([{ overflow: 40 }]);
  expect(s.skipping).toBe(true);
  expect(s.push('"ok":true}{"op":"evil"}')).toEqual([]);
  // … until its newline; the next line is read normally.
  expect(s.push('tail}\n{"c":3}\n')).toEqual([{ line: '{"c":3}' }]);
  expect(s.skipping).toBe(false);
  // An oversize line complete within one chunk is refused too, and the following one still passes.
  expect(s.push(`${"y".repeat(20)}\n{"d":4}\n`)).toEqual([{ overflow: 20 }, { line: '{"d":4}' }]);
});

test("AF_VSOCK: an oversize line gets an E2BIG reply and the stream resyncs at the next newline", async () => {
  const chunks = [`${"q".repeat(OBC_RPC_MAX_LINE + 10)}`, `${"r".repeat(1000)}{"op":"read"}\n`, `${JSON.stringify({ op: "ping" })}\n`];
  const replies: Record<string, unknown>[] = [];
  let finished!: () => void;
  const done = new Promise<void>((r) => {
    finished = r;
  });
  const dec = new TextDecoder();
  const conn = {
    readable: new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(b) {
        for (const l of dec.decode(b).split("\n")) if (l) replies.push(JSON.parse(l));
      },
    }),
    close: () => finished(),
  } as unknown as VsockConnection;
  let served = false;
  const vsock = {
    listen: () => ({
      accept: async () => {
        if (served) return new Promise(() => {});
        served = true;
        return conn;
      },
      close() {},
    }),
  } as unknown as Vsock;
  const h = startObcVsockServer(vsock, adapter, () => {});
  await done;
  h.close();
  expect(replies.length).toBe(2);
  expect(replies[0]).toMatchObject({ ok: false, code: "E2BIG" });
  // The tail of the oversize line (with its embedded {"op":"read"}) was never run; the next request was.
  expect(replies[1]).toMatchObject({ ok: true, pong: true });
});
