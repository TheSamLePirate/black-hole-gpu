// Video export: frames encoded with WebCodecs (H.264) and written as a fragmented MP4 (ISO BMFF):
// ftyp + moov (sample tables empty, mvex) + one moof/mdat fragment per frame. No dependency; plays in
// browsers, QuickTime and VLC.

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
    const trun = (offset: number) =>
      fbox("trun", 0, 0x000701, u32(1), u32(offset), u32(duration), u32(data.length), u32(flags));
    const traf = (offset: number) =>
      box("traf", fbox("tfhd", 0, 0x020000, u32(1)), fbox("tfdt", 1, 0, u64(this.decodeTime)), trun(offset));
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
    const tkhd = fbox("tkhd", 0, 3, u32(0), u32(0), u32(1), zeros(4), u32(0), zeros(8), u16(0), u16(0), u16(0), zeros(2), MATRIX, u32(w << 16), u32(h << 16));
    const mdhd = fbox("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0));
    const hdlr = fbox("hdlr", 0, 0, u32(0), enc.encode("vide"), zeros(12), enc.encode("Kerr ray tracer\0"));
    const vmhd = fbox("vmhd", 0, 1, zeros(8));
    const dinf = box("dinf", fbox("dref", 0, 0, u32(1), fbox("url ", 0, 1)));
    const avc1 = box(
      "avc1",
      zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x480000), u32(0x480000), zeros(4), u16(1), zeros(32), u16(0x18), u16(0xffff),
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

/** H.264 encoder writing into an Mp4Writer. Frames are RGBA8 pixel buffers. */
export class VideoWriter {
  private encoder: VideoEncoder;
  private mp4: Mp4Writer;
  private index = 0;
  private error: Error | null = null;

  static async supported(width: number, height: number, fps: number) {
    if (typeof VideoEncoder === "undefined") return null;
    for (const codec of ["avc1.640034", "avc1.640033", "avc1.640028"]) {
      const cfg: VideoEncoderConfig = { codec, width, height, framerate: fps, bitrate: VideoWriter.bitrate(width, height, fps), avc: { format: "avc" } };
      try {
        if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
      } catch {
        // try the next profile/level
      }
    }
    return null;
  }

  /** ~0.25 bit per pixel per frame: visually lossless for smooth, noise-free renders. */
  static bitrate(width: number, height: number, fps: number) {
    return Math.round(Math.min(80e6, Math.max(4e6, 0.25 * width * height * fps)));
  }

  constructor(
    cfg: VideoEncoderConfig,
    private fps: number,
  ) {
    this.mp4 = new Mp4Writer(cfg.width, cfg.height, fps);
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.mp4.add(chunk, meta),
      error: (e) => (this.error = e as Error),
    });
    this.encoder.configure(cfg);
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
    this.encoder.encode(frame, { keyFrame: this.index % Math.round(2 * this.fps) === 0 });
    frame.close();
    this.index++;
    // keep the encoder queue short (memory)
    while (this.encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
  }

  async finish(): Promise<Blob> {
    await this.encoder.flush();
    this.encoder.close();
    if (this.error) throw this.error;
    return this.mp4.finish();
  }
}
