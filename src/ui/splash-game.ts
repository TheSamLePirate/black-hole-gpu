// A small arcade for the wait of the loading screen: a 2D ship follows the mouse, a click (left or right, held to
// repeat) fires, asteroids come down and split. A canvas of a few dozen shapes — nothing next to the compile, which runs
// in the browser's GPU process. No game over: a hit only costs the score and a moment of blink.

type Rock = { x: number; y: number; vx: number; vy: number; r: number; a: number; va: number; hp: number; shape: number[] };
type Shot = { x: number; y: number; vx: number; vy: number };
type Dust = { r: number; a: number; s: number; o: number };
type Spark ={ x: number; y: number; vx: number; vy: number; life: number };

const MAX_ROCKS = 14;
const FIRE_EVERY = 0.16; // [s]

export class SplashGame {
  private cv = document.createElement("canvas");
  private g = this.cv.getContext("2d");
  private rocks: Rock[] = [];
  private shots: Shot[] = [];
  private sparks: Spark[] = [];
  private mx = 0;
  private my = 0;
  private sx = 0;
  private sy = 0;
  private firing = false;
  private fireIn = 0;
  private spawnIn = 0.5;
  private blink = 0;
  private score = 0;
  private raf = 0;
  private last = 0;
  private running = false;
  private t = 0;
  // the black hole: centre and radius [px], set each frame from the canvas size
  private hx = 0;
  private hy = 0;
  private hr = 40;
  private dust: Dust[] = Array.from({ length: 320 }, () => ({
    r: 1.35 + Math.random() ** 1.6 * 2.6,
    a: Math.random() * 6.283,
    s: 1.2 + Math.random() * 1.8,
    o: 0.5 + Math.random() * 0.5,
  }));

  constructor(private root: HTMLElement) {}

  start() {
    if (this.running || !this.g || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.running = true;
    const cv = this.cv;
    cv.className = "ld-game";
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5";
    this.root.append(cv);
    this.root.style.cursor = "crosshair";
    this.root.classList.add("arcade");
    this.mx = this.sx = innerWidth / 2;
    this.my = this.sy = innerHeight * 0.8;
    const r = this.root;
    r.addEventListener("pointermove", this.move);
    r.addEventListener("pointerdown", this.down);
    addEventListener("pointerup", this.up);
    r.addEventListener("contextmenu", this.noMenu);
    document.addEventListener("visibilitychange", this.visibility);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    const r = this.root;
    r.removeEventListener("pointermove", this.move);
    r.removeEventListener("pointerdown", this.down);
    removeEventListener("pointerup", this.up);
    r.removeEventListener("contextmenu", this.noMenu);
    document.removeEventListener("visibilitychange", this.visibility);
    r.style.cursor = "";
    r.classList.remove("arcade");
    this.cv.remove();
  }

  private move = (e: PointerEvent) => ((this.mx = e.clientX), (this.my = e.clientY));
  private down = (e: PointerEvent) => {
    // (the skip button is a button: its click is not a shot)
    if ((e.target as HTMLElement).closest?.("button")) return;
    this.mx = e.clientX;
    this.my = e.clientY;
    this.firing = true;
    this.fireIn = 0;
  };
  private up = () => (this.firing = false);
  private noMenu = (e: Event) => e.preventDefault();
  private visibility = () => {
    cancelAnimationFrame(this.raf);
    this.last = 0;
    if (!document.hidden && this.running) this.raf = requestAnimationFrame(this.frame);
  };

  /** the theme behind the game: the title, and a tilted accretion disk (back half, shadow, front half) around a black hole */
  private backdrop(g: CanvasRenderingContext2D, w: number, h: number) {
    const { hx: cx, hy: cy, hr: R } = this;
    const tilt = 0.26;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `900 ${Math.min(w * 0.16, h * 0.24, 220)}px system-ui, sans-serif`;
    g.fillStyle = "rgba(140,185,255,0.1)";
    g.fillText("KERR", cx, h * 0.22);
    const glow = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 4.5);
    glow.addColorStop(0, "rgba(255,170,90,0.22)");
    glow.addColorStop(1, "rgba(255,170,90,0)");
    g.fillStyle = glow;
    g.fillRect(cx - R * 5, cy - R * 5, R * 10, R * 10);
    g.globalCompositeOperation = "lighter";
    const dot = (p: Dust, back: boolean) => {
      const a = p.a + this.t * 1.1 * p.r ** -1.5;
      const s = Math.sin(a);
      if (s < 0 !== back) return;
      const x = cx + Math.cos(a) * p.r * R;
      // (the far half is lensed over the top of the hole)
      const y = cy + s * p.r * R * tilt - (back ? (R * 1.15 * -s) / Math.sqrt(p.r) : 0);
      const doppler = 0.55 + 0.45 * Math.cos(a - 0.6);
      g.fillStyle = `rgba(255,${150 + 90 * doppler | 0},${80 + 120 * doppler | 0},${(0.25 + 0.6 * doppler) * p.o})`;
      g.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
    };
    for (const p of this.dust) dot(p, true);
    g.globalCompositeOperation = "source-over";
    g.beginPath();
    g.arc(cx, cy, R, 0, 6.283);
    g.fillStyle = "#000";
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,210,150,0.55)";
    g.stroke();
    g.globalCompositeOperation = "lighter";
    for (const p of this.dust) dot(p, false);
    g.restore();
  }

  private spawn(w: number) {
    const r = 18 + Math.random() * 30;
    const n = 9;
    this.rocks.push({
      x: r + Math.random() * (w - 2 * r),
      y: -r,
      vx: (Math.random() - 0.5) * 60,
      vy: 40 + Math.random() * 70,
      r,
      a: Math.random() * 6.28,
      va: (Math.random() - 0.5) * 1.5,
      hp: r > 34 ? 3 : r > 24 ? 2 : 1,
      shape: Array.from({ length: n }, () => 0.72 + Math.random() * 0.4),
    });
  }

  private burst(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28;
      const s = 40 + Math.random() * 140;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4 });
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - (this.last || now)) / 1000, 0.05);
    this.last = now;
    const cv = this.cv;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) ((cv.width = w), (cv.height = h));
    const g = this.g!;
    g.clearRect(0, 0, w, h);
    this.t += dt;
    this.hx = w / 2;
    this.hy = h * 0.56;
    this.hr = Math.min(w, h) * 0.06;
    this.backdrop(g, w, h);
    // gravity: a = GM / d² toward the hole (the missiles are pulled harder: they are lighter)
    const GM = 650 * this.hr * this.hr;
    const pull = (o: { x: number; y: number; vx: number; vy: number }, k: number, dt: number) => {
      const dx = this.hx - o.x;
      const dy = this.hy - o.y;
      const d2 = Math.max(dx * dx + dy * dy, this.hr * this.hr);
      const a = (GM * k) / d2 / Math.sqrt(d2);
      o.vx += dx * a * dt;
      o.vy += dy * a * dt;
    };
    const eaten = (o: { x: number; y: number }, m = 0.9) => Math.hypot(o.x - this.hx, o.y - this.hy) < this.hr * m;

    // ship: eased to the mouse
    const k = Math.min(dt * 14, 1);
    this.sx += (this.mx - this.sx) * k;
    this.sy += (this.my - this.sy) * k;
    this.blink = Math.max(0, this.blink - dt);

    // fire
    this.fireIn -= dt;
    if (this.firing && this.fireIn <= 0 && this.shots.length < 40) {
      this.fireIn = FIRE_EVERY;
      this.shots.push(
        { x: this.sx - 9, y: this.sy - 14, vx: 0, vy: -620 },
        { x: this.sx + 9, y: this.sy - 14, vx: 0, vy: -620 },
      );
    }
    for (const s of this.shots) {
      pull(s, 2.5, dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (eaten(s)) s.y = -100;
    }
    this.shots = this.shots.filter((s) => s.y > -20 && s.y < h + 20 && s.x > -20 && s.x < w + 20);

    // rocks
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.rocks.length < MAX_ROCKS) {
      this.spawn(w);
      this.spawnIn = 0.7 + Math.random() * 0.9;
    }
    const born: Rock[] = [];
    for (const r of this.rocks) {
      pull(r, 1, dt);
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.a += r.va * dt;
      if (r.x < r.r || r.x > w - r.r) r.vx = -r.vx;
      // swallowed: it spirals in and vanishes (no score)
      if (r.hp > 0 && eaten(r, 0.8)) {
        r.hp = 0;
        this.burst(this.hx, this.hy, 6);
        continue;
      }
      for (const s of this.shots) {
        if (r.hp > 0 && Math.hypot(s.x - r.x, s.y - r.y) < r.r) {
          s.y = -100;
          r.hp--;
          this.burst(s.x, s.y + 0, 3);
          if (r.hp <= 0) {
            this.score += Math.round(r.r);
            this.burst(r.x, r.y, 12);
            if (r.r > 24)
              for (const d of [-1, 1]) born.push({ ...r, r: r.r * 0.55, hp: 1, vx: r.vx + d * 70, vy: r.vy - 10, shape: r.shape });
          }
        }
      }
      if (r.hp > 0 && this.blink <= 0 && Math.hypot(this.sx - r.x, this.sy - r.y) < r.r + 8) {
        this.blink = 1.4;
        this.score = Math.max(0, this.score - 25);
        this.burst(this.sx, this.sy, 14);
      }
    }
    this.rocks = this.rocks.filter((r) => r.hp > 0 && r.y < h + r.r).concat(born);

    for (const p of this.sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.sparks = this.sparks.filter((p) => p.life > 0);

    // draw
    g.lineJoin = "round";
    g.lineWidth = 1.6;
    g.strokeStyle = "rgba(190,215,255,0.85)";
    g.fillStyle = "rgba(20,30,50,0.55)";
    for (const r of this.rocks) {
      g.beginPath();
      r.shape.forEach((m, i) => {
        const a = r.a + (i / r.shape.length) * 6.283;
        const px = r.x + Math.cos(a) * r.r * m;
        const py = r.y + Math.sin(a) * r.r * m;
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      });
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.fillStyle = "rgba(255,230,160,0.95)";
    g.strokeStyle = "rgba(255,230,160,0.95)";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    for (const s of this.shots) {
      const k = 7 / Math.hypot(s.vx, s.vy);
      g.moveTo(s.x - s.vx * k, s.y - s.vy * k);
      g.lineTo(s.x + s.vx * k, s.y + s.vy * k);
    }
    g.stroke();
    g.lineWidth = 1.6;
    for (const p of this.sparks) {
      g.fillStyle = `rgba(255,200,130,${Math.min(1, p.life * 2).toFixed(2)})`;
      g.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
    }
    if (this.blink <= 0 || Math.floor(this.blink * 10) % 2 === 0) {
      g.save();
      g.translate(this.sx, this.sy);
      g.beginPath();
      g.moveTo(0, -16);
      g.lineTo(11, 12);
      g.lineTo(0, 7);
      g.lineTo(-11, 12);
      g.closePath();
      g.fillStyle = "rgba(111,210,255,0.25)";
      g.strokeStyle = "rgba(140,225,255,0.95)";
      g.fill();
      g.stroke();
      g.restore();
    }
    g.font = "600 15px system-ui, sans-serif";
    g.fillStyle = "rgba(200,225,255,0.8)";
    g.textAlign = "right";
    g.fillText(`★ ${this.score}`, w - 18, 76);
  };
}
