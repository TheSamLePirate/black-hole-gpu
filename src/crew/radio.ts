import type { NetClient } from "../net/client";
import { TalkGate } from "./ptt";

/** A voice-only bus: no engines, worklets, radio synthesis or simulator imports. */
export class CrewRadio {
  readonly gate: TalkGate;
  listening = false;
  error = "";
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private generation = 0;
  private pending = false;
  get requesting() {
    return this.pending;
  }
  private peers = new Map<
    number,
    { stream: MediaStream; el: HTMLAudioElement; source: MediaStreamAudioSourceNode; gain: GainNode; meter: AnalyserNode }
  >();
  private incoming = new Map<number, MediaStream>();
  private volumes = new Map<number, number>();
  private muted = new Set<number>();
  private devices = new Map<number, string>();
  private buf = new Float32Array(256);
  /** the transmission begun or ended (the CAPCOM's Quindar tones — PLAN-VAISSEAUX K5) */
  onTalk?: (active: boolean) => void;

  constructor(
    readonly net: NetClient,
    private changed: () => void,
  ) {
    this.gate = new TalkGate((active) => {
      for (const track of this.mic?.getAudioTracks() ?? []) track.enabled = active;
      if (active) navigator.vibrate?.(12);
      this.onTalk?.(active);
      changed();
    });
    net.on("voice", ({ slot, stream }) => {
      this.drop(slot);
      if (stream) {
        this.incoming.set(slot, stream);
        this.attach(slot, stream);
      } else this.incoming.delete(slot);
    });
    net.on("status", () => {
      this.gate.availability(!!this.mic, net.status === "online" && !!net.room);
      changed();
    });
    net.on("room", (room) => {
      this.gate.cancel();
      this.gate.availability(!!this.mic, net.status === "online" && !!room);
      if (!room) this.stop();
    });
    net.on("roster", (members) => {
      for (const [slot, device] of this.devices)
        if (!members.some((m) => m.slot === slot && m.device === device)) {
          this.drop(slot);
          this.incoming.delete(slot);
          this.volumes.delete(slot);
          this.muted.delete(slot);
        }
      this.devices = new Map(members.map((m) => [m.slot, m.device]));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.gate.cancel();
      else if (this.listening) void this.listen();
    });
  }

  async listen() {
    try {
      this.ctx ??= new AudioContext({ latencyHint: "interactive" });
      await this.ctx.resume();
      this.listening = this.ctx.state === "running";
      for (const [slot, stream] of this.incoming) if (!this.peers.has(slot)) this.attach(slot, stream);
      for (const peer of this.peers.values()) await peer.el.play().catch(() => {});
      this.error = this.listening ? "" : "Touchez Écouter pour reprendre le son.";
    } catch {
      this.error = "Le son est bloqué. Touchez Écouter pour réessayer.";
    }
    this.changed();
  }

  async enableMic() {
    if (this.mic || this.pending || !this.net.room) return;
    this.pending = true;
    const generation = ++this.generation;
    this.error = "Autorisez le microphone dans votre navigateur, ou annulez la demande.";
    this.changed();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("https");
      // Start/resume inside the gesture, before awaiting the permission prompt.
      void this.listen();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      for (const track of stream.getAudioTracks()) track.enabled = false;
      if (generation !== this.generation || !this.net.room || document.hidden) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.mic = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("missing");
      track.addEventListener("ended", () => this.disableMic());
      track.addEventListener("mute", () => this.gate.cancel());
      this.net.setMic(track);
      this.gate.availability(true, this.net.status === "online");
      this.error = "";
    } catch (error) {
      if (generation !== this.generation) return;
      this.error =
        error instanceof Error && error.message === "https"
          ? "Le microphone nécessite HTTPS (ou localhost)."
          : "Microphone indisponible ou permission refusée. L’écoute reste possible.";
    } finally {
      if (generation === this.generation) this.pending = false;
      this.changed();
    }
  }

  disableMic() {
    ++this.generation;
    this.pending = false;
    this.error = "";
    this.gate.availability(false, !!this.net.room && this.net.status === "online");
    this.net.setMic(null);
    const mic = this.mic;
    this.mic = null;
    for (const track of mic?.getTracks() ?? []) track.stop();
    this.changed();
  }

  private attach(slot: number, stream: MediaStream) {
    const ctx = this.ctx;
    if (!ctx) return;
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true; // Chrome keeps a remote audio stream alive with its media element.
    void el.play().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 256;
    gain.gain.value = this.muted.has(slot) ? 0 : (this.volumes.get(slot) ?? 1);
    source.connect(meter).connect(gain).connect(ctx.destination);
    this.peers.set(slot, { stream, el, source, gain, meter });
  }

  volume(slot: number, value?: number) {
    if (value !== undefined) this.volumes.set(slot, Math.max(0, Math.min(1, value)));
    const volume = this.volumes.get(slot) ?? 1;
    const peer = this.peers.get(slot);
    if (peer) peer.gain.gain.value = this.muted.has(slot) ? 0 : volume;
    return volume;
  }
  mute(slot: number) {
    if (this.muted.has(slot)) this.muted.delete(slot);
    else this.muted.add(slot);
    this.volume(slot);
    return this.muted.has(slot);
  }
  isMuted(slot: number) {
    return this.muted.has(slot);
  }
  speaking(slot: number) {
    const peer = this.peers.get(slot);
    if (!peer || !this.listening || this.muted.has(slot)) return false;
    peer.meter.getFloatTimeDomainData(this.buf);
    return this.buf.reduce((s, x) => s + x * x, 0) / this.buf.length > 0.00001;
  }
  private drop(slot: number) {
    const peer = this.peers.get(slot);
    if (!peer) return;
    peer.source.disconnect();
    peer.meter.disconnect();
    peer.gain.disconnect();
    peer.el.pause();
    peer.el.srcObject = null;
    this.peers.delete(slot);
  }
  stop() {
    this.disableMic();
    for (const slot of this.peers.keys()) this.drop(slot);
    this.incoming.clear();
    this.volumes.clear();
    this.muted.clear();
    this.devices.clear();
    this.listening = false;
    void this.ctx?.close();
    this.ctx = null;
  }
}
