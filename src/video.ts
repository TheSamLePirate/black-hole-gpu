// Video export: frames encoded with WebCodecs and written with no dependency —
//  - MP4 (H.264): a fragmented ISO BMFF, ftyp + moov (sample tables empty, mvex) + one moof/mdat fragment per
//    frame; plays in browsers, QuickTime and VLC;
//  - WebM (VP9, else VP8): a Matroska file, its seek head, info and track, clusters of simple blocks (one per
//    key frame) and the cues to seek by; plays in browsers and VLC.
// The format asked when this browser encodes it, else the other (PLAN-MODES-AAA M8: MP4 and WebM).

const enc = new TextEncoder();

function u32(n: number) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function u16(n: number) {
  return new Uint8Array([(n >>> 8) & 255, n & 255]);
}
function u64(n: number) {
  const hi = Math.floor(n / 2 ** 32);
  return new Uint8Array([...u32(hi), ...u32(n >>> 0)]);
}
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(payload);
  return concat([u32(body.length + 8), enc.encode(type), body]);
}
/** Full box: version + 24-bit flags. */
function fbox(type: string, version: number, flags: number, ...payload: Uint8Array[]) {
  return box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...payload);
}
const zeros = (n: number) => new Uint8Array(n);
const MATRIX = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

const TIMESCALE = 90000;

export class Mp4Writer {
  private fragments: Uint8Array[] = [];
  private seq = 1;
  private decodeTime = 0;
  private avcC: Uint8Array | null = null;

  constructor(
    private width: number,
    private height: number,
    private fps: number,
  ) {}

  add(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
    const desc = meta?.decoderConfig?.description;
    if (desc && !this.avcC) {
      this.avcC = ArrayBuffer.isView(desc)
        ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength).slice()
        : new Uint8Array(desc as ArrayBuffer).slice();
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const duration = Math.round(TIMESCALE / this.fps);
    const key = chunk.type === "key";
    // sample flags: sync sample (depends on nothing) / non-sync (depends on others)
    const flags = key ? 0x02000000 : 0x01010000;
    const trun = (offset: number) => fbox("trun", 0, 0x000701, u32(1), u32(offset), u32(duration), u32(data.length), u32(flags));
    const traf = (offset: number) => box("traf", fbox("tfhd", 0, 0x020000, u32(1)), fbox("tfdt", 1, 0, u64(this.decodeTime)), trun(offset));
    const moofOf = (offset: number) => box("moof", fbox("mfhd", 0, 0, u32(this.seq)), traf(offset));
    const moof = moofOf(moofOf(0).length + 8); // data offset from the start of moof to the sample
    this.fragments.push(moof, box("mdat", data));
    this.seq++;
    this.decodeTime += duration;
  }

  finish(): Blob {
    if (!this.avcC) throw new Error("no decoder configuration from the encoder");
    const w = this.width;
    const h = this.height;
    const ftyp = box("ftyp", enc.encode("isom"), u32(0x200), enc.encode("isomiso6avc1mp41"));
    const mvhd = fbox("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2));
    const tkhd = fbox(
      "tkhd",
      0,
      3,
      u32(0),
      u32(0),
      u32(1),
      zeros(4),
      u32(0),
      zeros(8),
      u16(0),
      u16(0),
      u16(0),
      zeros(2),
      MATRIX,
      u32(w << 16),
      u32(h << 16),
    );
    const mdhd = fbox("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0));
    const hdlr = fbox("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("Kerr ray tracer\0"));
    const vmhd = fbox("vmhd", 0, 1, zeros(8));
    const dinf = box("dinf", fbox("dref", 0, 0, u32(1), fbox("url ", 0, 1)));
    const avc1 = box(
      "avc1",
      zeros(6),
      u16(1),
      zeros(16),
      u16(w),
      u16(h),
      u32(0x480000),
      u32(0x480000),
      zeros(4),
      u16(1),
      zeros(32),
      u16(0x18),
      u16(0xffff),
      box("avcC", this.avcC),
    );
    const stbl = box(
      "stbl",
      fbox("stsd", 0, 0, u32(1), avc1),
      fbox("stts", 0, 0, u32(0)),
      fbox("stsc", 0, 0, u32(0)),
      fbox("stsz", 0, 0, u32(0), u32(0)),
      fbox("stco", 0, 0, u32(0)),
    );
    const minf = box("minf", vmhd, dinf, stbl);
    const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
    const mvex = box("mvex", fbox("trex", 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)));
    const moov = box("moov", mvhd, trak, mvex);
    return new Blob([ftyp, moov, ...this.fragments] as BlobPart[], { type: "video/mp4" });
  }
}

// ------------------------------------------------------------------ WebM (Matroska)

/** An EBML element's size as a variable-length integer: the shortest that holds it (all ones is "unknown"). */
export function ebmlSize(n: number): Uint8Array {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v % 256;
        v = Math.floor(v / 256);
      }
      out[0]! |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error(`EBML size too large: ${n}`);
}
/** An unsigned integer's big-endian bytes, `len` of them (else the fewest). */
function uint(n: number, len?: number): Uint8Array {
  let l = len ?? 1;
  if (len === undefined) while (n >= 2 ** (8 * l)) l++;
  const out = new Uint8Array(l);
  let v = n;
  for (let i = l - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}
const idBytes = (id: number) => uint(id);
/** An EBML element: its ID, its size, its payload. */
function ebml(id: number, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  return concat([idBytes(id), ebmlSize(body.length), body]);
}
const ebmlUint = (id: number, n: number, len?: number) => ebml(id, uint(n, len));
const ebmlString = (id: number, x: string) => ebml(id, enc.encode(x));
function ebmlFloat(id: number, x: number) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x);
  return ebml(id, b);
}
const W = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675,
  Cues: 0x1c53bb6b,
} as const;

/** One encoded frame for the WebM writer: its bytes, whether it is a key frame, its time [µs]. */
export interface WebmChunk {
  data: Uint8Array;
  key: boolean;
  timestampUs: number;
}

/**
 * The WebM writer: the encoded frames kept, the file built at the end (sizes known: no "unknown size" to patch) —
 * a cluster from each key frame (and every 30 s at most: a block's time is 16 bits of milliseconds from its
 * cluster's), the cues pointing at them.
 */
export class WebmWriter {
  private frames: WebmChunk[] = [];

  constructor(
    private width: number,
    private height: number,
    private fps: number,
    private codec: "V_VP9" | "V_VP8",
  ) {}

  add(c: WebmChunk) {
    this.frames.push({ data: c.data.slice(), key: c.key, timestampUs: c.timestampUs });
  }

  finish(): Blob {
    if (!this.frames.length) throw new Error("no frames to write");
    const ms = (us: number) => Math.round(us / 1000);
    const header = ebml(
      W.EBML,
      ebmlUint(0x4286, 1),
      ebmlUint(0x42f7, 1),
      ebmlUint(0x42f2, 4),
      ebmlUint(0x42f3, 8),
      ebmlString(0x4282, "webm"),
      ebmlUint(0x4287, 4),
      ebmlUint(0x4285, 2),
    );
    const frameMs = 1000 / this.fps;
    const info = ebml(
      W.Info,
      ebmlUint(0x2ad7b1, 1_000_000),
      ebmlString(0x4d80, "Kerr ray tracer"),
      ebmlString(0x5741, "Kerr ray tracer"),
      ebmlFloat(0x4489, ms(this.frames[this.frames.length - 1]!.timestampUs) + frameMs),
    );
    const tracks = ebml(
      W.Tracks,
      ebml(
        0xae,
        ebmlUint(0xd7, 1),
        ebmlUint(0x73c5, 1),
        ebmlUint(0x83, 1),
        ebmlUint(0x9c, 0),
        ebmlString(0x86, this.codec),
        ebmlUint(0x23e383, Math.round(1e9 / this.fps)),
        ebml(0xe0, ebmlUint(0xb0, this.width), ebmlUint(0xba, this.height)),
      ),
    );
    // the clusters
    const clusters: { time: number; bytes: Uint8Array }[] = [];
    let cur: { time: number; blocks: Uint8Array[] } | null = null;
    const close = () => cur && clusters.push({ time: cur.time, bytes: ebml(W.Cluster, ebmlUint(0xe7, cur.time), ...cur.blocks) });
    for (const f of this.frames) {
      const t = ms(f.timestampUs);
      if (!cur || f.key || t - cur.time > 30_000) {
        close();
        cur = { time: t, blocks: [] };
      }
      const rel = t - cur.time;
      const head = new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, f.key ? 0x80 : 0]);
      cur.blocks.push(ebml(0xa3, head, f.data));
    }
    close();
    // (the seek head's size fixed — 8-byte positions — so the positions after it are known before it is written)
    const seekEntry = (id: number, pos: number) => ebml(W.Seek, ebml(W.SeekID, idBytes(id)), ebmlUint(W.SeekPosition, pos, 8));
    const seekLen = ebml(W.SeekHead, seekEntry(W.Info, 0), seekEntry(W.Tracks, 0), seekEntry(W.Cues, 0)).length;
    const infoAt = seekLen;
    const tracksAt = infoAt + info.length;
    let at = tracksAt + tracks.length;
    const cuePoints: Uint8Array[] = [];
    for (const c of clusters) {
      cuePoints.push(ebml(0xbb, ebmlUint(0xb3, c.time), ebml(0xb7, ebmlUint(0xf7, 1), ebmlUint(0xf1, at))));
      at += c.bytes.length;
    }
    const cues = ebml(W.Cues, ...cuePoints);
    const seekHead = ebml(W.SeekHead, seekEntry(W.Info, infoAt), seekEntry(W.Tracks, tracksAt), seekEntry(W.Cues, at));
    const segment = ebml(W.Segment, seekHead, info, tracks, ...clusters.map((c) => c.bytes), cues);
    return new Blob([header, segment] as BlobPart[], { type: "video/webm" });
  }
}

// ------------------------------------------------------------------ the encoder

/** The formats written: the file's container and its codec. */
export type VideoFormat = "mp4" | "webm";
export const VIDEO_EXT: Record<VideoFormat, string> = { mp4: "mp4", webm: "webm" };

/** The encoder (H.264 into an Mp4Writer, VP9 or VP8 into a WebmWriter). Frames are RGBA8 pixel buffers. */
export class VideoWriter {
  private encoder: VideoEncoder;
  private mp4: Mp4Writer | null = null;
  private webm: WebmWriter | null = null;
  private index = 0;
  private error: Error | null = null;

  /**
   * The encoder's configuration for a size and a rate: the format asked if this browser encodes it there, else
   * the other one (null: neither). Its format with it.
   */
  static async supported(width: number, height: number, fps: number, prefer: VideoFormat = "mp4") {
    if (typeof VideoEncoder === "undefined") return null;
    const bitrate = VideoWriter.bitrate(width, height, fps);
    const tries: Record<VideoFormat, VideoEncoderConfig[]> = {
      mp4: ["avc1.640034", "avc1.640033", "avc1.640028"].map((codec) => ({
        codec,
        width,
        height,
        framerate: fps,
        bitrate,
        avc: { format: "avc" },
      })),
      webm: ["vp09.00.41.08", "vp09.00.10.08", "vp8"].map((codec) => ({ codec, width, height, framerate: fps, bitrate })),
    };
    for (const format of prefer === "mp4" ? (["mp4", "webm"] as const) : (["webm", "mp4"] as const))
      for (const cfg of tries[format]) {
        try {
          if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...cfg, format };
        } catch {
          // try the next profile, level or codec
        }
      }
    return null;
  }

  /** ~0.25 bit per pixel per frame: visually lossless for smooth, noise-free renders. */
  static bitrate(width: number, height: number, fps: number) {
    return Math.round(Math.min(80e6, Math.max(4e6, 0.25 * width * height * fps)));
  }

  readonly format: VideoFormat;

  constructor(
    cfg: VideoEncoderConfig & { format?: VideoFormat },
    private fps: number,
  ) {
    const { format = "mp4", ...config } = cfg;
    this.format = format;
    if (format === "mp4") this.mp4 = new Mp4Writer(cfg.width, cfg.height, fps);
    else this.webm = new WebmWriter(cfg.width, cfg.height, fps, cfg.codec.startsWith("vp8") ? "V_VP8" : "V_VP9");
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (this.mp4) this.mp4.add(chunk, meta);
        else {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.webm!.add({ data, key: chunk.type === "key", timestampUs: chunk.timestamp });
        }
      },
      error: (e) => (this.error = e as Error),
    });
    this.encoder.configure(config);
  }

  async addFrame(rgba: Uint8Array, width: number, height: number) {
    if (this.error) throw this.error;
    const frame = new VideoFrame(rgba, {
      format: "RGBA",
      codedWidth: width,
      codedHeight: height,
      timestamp: Math.round((this.index * 1e6) / this.fps),
      duration: Math.round(1e6 / this.fps),
    });
    try {
      this.encoder.encode(frame, { keyFrame: this.index % Math.round(2 * this.fps) === 0 });
    } finally {
      frame.close();
    }
    this.index++;
    // keep the encoder queue short (memory)
    while (this.encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
  }

  /** Release native codec resources on success, cancellation, or a failed render. */
  close() {
    if (this.encoder.state !== "closed") this.encoder.close();
  }

  async finish(): Promise<Blob> {
    try {
      await this.encoder.flush();
      if (this.error) throw this.error;
      return this.mp4 ? this.mp4.finish() : this.webm!.finish();
    } finally {
      this.close();
    }
  }
}
