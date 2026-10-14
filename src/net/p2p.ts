// The players' direct links (docs/PLAN-RESEAU.md, « Transport »): a WebRTC data channel to each other member of
// the room — unordered, never resent (a late sample is worthless: the next one is on its way) —, set up through
// the room server (its offers, answers and candidates relayed), the lower slot offering. The craft's samples go
// straight to each peer reached so; the others still get them through the server. The same room, one machine or
// one house: a few milliseconds; across the country: no detour through the server.

export interface PeerLink {
  slot: number;
  pc: RTCPeerConnection;
  ch: RTCDataChannel | null;
  /** "new" → "connecting" → "open" | "failed" | "closed" */
  state: string;
  /** the round trip measured on the link's candidate pair [ms] */
  rtt: number;
  /** "host" (the same network), "srflx" (through NAT), "relay" (TURN), "" not yet known */
  route: string;
  pending: RTCIceCandidateInit[];
  bytes: { up: number; down: number };
}

export type SignalData = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export interface MeshOptions {
  /** our slot now */
  self: () => number;
  /** a signal to another member, through the room server */
  signal: (to: number, data: SignalData) => void;
  /** a sample come straight from a peer */
  onData: (buf: ArrayBuffer) => void;
  ice: RTCIceServer[];
}

/** STUN only for now (Cloudflare's, no account): TURN — coturn on the server — comes with the voice (R2). */
export const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

export const p2pAvailable = () => typeof RTCPeerConnection !== "undefined";

export class PeerMesh {
  readonly peers = new Map<number, PeerLink>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private o: MeshOptions) {
    this.statsTimer = setInterval(() => void this.measure(), 2000);
  }

  /** The room's members now: a link to each other one, those gone closed. */
  sync(slots: number[]) {
    const me = this.o.self();
    const want = new Set(slots.filter((s) => s !== me));
    for (const s of [...this.peers.keys()]) if (!want.has(s)) this.drop(s);
    // (the lower slot offers; the higher one waits for its offer)
    for (const s of want) if (!this.peers.has(s) && me < s) void this.offer(s);
  }

  private link(slot: number): PeerLink {
    const pc = new RTCPeerConnection({ iceServers: this.o.ice });
    const L: PeerLink = { slot, pc, ch: null, state: "new", rtt: Number.NaN, route: "", pending: [], bytes: { up: 0, down: 0 } };
    pc.onicecandidate = (e) => e.candidate && this.o.signal(slot, { candidate: e.candidate.toJSON() });
    pc.ondatachannel = (e) => this.channel(L, e.channel);
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed" || s === "closed") {
        L.state = s;
        // (tried again by the offering side, a little later)
        if (s === "failed" && !this.closed && this.o.self() < slot)
          setTimeout(() => {
            if (this.peers.get(slot) === L) {
              this.drop(slot);
              void this.offer(slot);
            }
          }, 3000);
      } else if (s === "connecting" && L.state === "new") L.state = "connecting";
    };
    this.peers.set(slot, L);
    return L;
  }

  private channel(L: PeerLink, ch: RTCDataChannel) {
    ch.binaryType = "arraybuffer";
    L.ch = ch;
    ch.onopen = () => (L.state = "open");
    ch.onclose = () => (L.state = "closed");
    ch.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      L.bytes.down += e.data.byteLength;
      this.o.onData(e.data);
    };
  }

  private async offer(slot: number) {
    const L = this.link(slot);
    this.channel(L, L.pc.createDataChannel("pose", { ordered: false, maxRetransmits: 0 }));
    L.state = "connecting";
    try {
      await L.pc.setLocalDescription(await L.pc.createOffer());
      this.o.signal(slot, { sdp: L.pc.localDescription!.toJSON() });
    } catch {
      L.state = "failed";
    }
  }

  /** A signal from another member (its offer, its answer, a candidate). */
  async onSignal(from: number, data: SignalData) {
    if (this.closed) return;
    let L = this.peers.get(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === "offer") {
          // (an offer: a fresh link — the other side began again)
          if (L) this.drop(from);
          L = this.link(from);
          L.state = "connecting";
          await L.pc.setRemoteDescription(data.sdp);
          await L.pc.setLocalDescription(await L.pc.createAnswer());
          this.o.signal(from, { sdp: L.pc.localDescription!.toJSON() });
        } else if (L && L.pc.signalingState === "have-local-offer") await L.pc.setRemoteDescription(data.sdp);
        for (const c of L?.pending.splice(0) ?? []) await L!.pc.addIceCandidate(c);
      } else if (data.candidate && L) {
        if (L.pc.remoteDescription) await L.pc.addIceCandidate(data.candidate);
        else L.pending.push(data.candidate);
      }
    } catch {
      /* a stale signal: the link sets itself up again */
    }
  }

  /** A sample to every peer reached directly; the slots reached. */
  send(buf: ArrayBuffer): Set<number> {
    const reached = new Set<number>();
    for (const L of this.peers.values())
      if (L.ch?.readyState === "open" && L.ch.bufferedAmount < 64_000) {
        try {
          L.ch.send(buf);
          L.bytes.up += buf.byteLength;
          reached.add(L.slot);
        } catch {
          /* closing */
        }
      }
    return reached;
  }

  /** each link's round trip and route, from its selected candidate pair */
  private async measure() {
    for (const L of this.peers.values()) {
      if (L.state !== "open") continue;
      try {
        const st = await L.pc.getStats();
        let pair: { currentRoundTripTime?: number; localCandidateId?: string } | null = null;
        st.forEach((r) => {
          if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.state === "succeeded") pair = r;
        });
        const p = pair as { currentRoundTripTime?: number; localCandidateId?: string } | null;
        if (p?.currentRoundTripTime !== undefined) L.rtt = p.currentRoundTripTime * 1000;
        const loc = p?.localCandidateId ? (st.get(p.localCandidateId) as { candidateType?: string } | undefined) : undefined;
        if (loc?.candidateType) L.route = loc.candidateType;
      } catch {
        /* closed meanwhile */
      }
    }
  }

  drop(slot: number) {
    const L = this.peers.get(slot);
    if (!L) return;
    this.peers.delete(slot);
    try {
      L.ch?.close();
      L.pc.close();
    } catch {
      /* gone */
    }
  }

  close() {
    this.closed = true;
    if (this.statsTimer) clearInterval(this.statsTimer);
    for (const s of [...this.peers.keys()]) this.drop(s);
  }
}
