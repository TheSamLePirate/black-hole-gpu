// A video seen as soon as it is done (PLAN-MODES-AAA M8): a draft played in a loop over the game — the shot and its
// timing judged at once —, then saved as it is, or rendered at full quality (the same shot, its length and rate),
// or dropped. A final's preview: saved already, played.

import "./videopreview.css";
import type { VideoDone } from "../renderdialog";
import { t, tf } from "../i18n";
import { button, el, h, modal } from "./kit";

export interface VideoPreviewHost {
  download(b: Blob, name: string): void;
  /** the same shot rendered at full quality: why not, or null */
  final(v: VideoDone): string | null;
  /** the shot's name */
  shotName(v: VideoDone): string;
  /** the final's size (the render dialog's) */
  finalSize(): { width: number; height: number };
}

export class VideoPreview {
  private close: (() => void) | null = null;

  constructor(private d: VideoPreviewHost) {}

  get isOpen() {
    return !!this.close;
  }

  show(v: VideoDone) {
    this.close?.();
    const url = URL.createObjectURL(v.blob);
    const video = h("video", {
      class: "vp-video",
      src: url,
      controls: "",
      autoplay: "",
      loop: "",
      muted: "",
      playsinline: "",
      "data-testid": "video-preview-player",
    }) as HTMLVideoElement;
    video.muted = true;
    const mb = (v.blob.size / 2 ** 20).toFixed(v.blob.size < 10 * 2 ** 20 ? 1 : 0);
    const facts = el(
      "p",
      "vp-facts",
      [
        this.d.shotName(v),
        v.draft ? t("draft") : null,
        `${v.width}×${v.height}`,
        `${v.fps} fps`,
        `${v.seconds.toFixed(v.seconds < 10 ? 1 : 0)} s`,
        `${v.format.toUpperCase()} · ${mb} MB`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const why = el("p", "vp-why", "");
    const acts = el("div", "vp-acts");
    acts.append(
      button({
        label: v.draft ? t("Save the draft") : t("Save again"),
        testid: "video-preview-save",
        onClick: () => this.d.download(v.blob, v.name),
      }),
    );
    if (v.draft)
      acts.append(
        button({
          label: t("Render the final"),
          kind: "primary",
          testid: "video-preview-final",
          onClick: () => {
            const no = this.d.final(v);
            if (no) why.textContent = no;
            else this.hide();
          },
        }),
      );
    acts.append(button({ label: t("Close"), testid: "video-preview-close", onClick: () => this.hide() }));
    const m = modal({
      title: v.draft ? t("Draft video") : t("Video"),
      body: [video, facts, why, acts],
      cls: "vp-frame",
      testid: "video-preview",
      onClose: () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
        this.close = null;
      },
    });
    this.close = m.close;
    void video.play().catch(() => {});
    if (v.draft) {
      const f = this.d.finalSize();
      why.textContent = tf(
        "The final: the same shot at {0}×{1}, with the render dialog's samples, integrator and motion blur",
        f.width,
        f.height,
      );
    }
  }

  hide() {
    this.close?.();
  }
}
