// A video's plan (photo/videoplan.ts, PLAN-MODES-AAA M8).
import { expect, test } from "bun:test";
import { draftSize, videoFrames, videoName } from "../src/photo/videoplan";

test("the draft's size: fitted in 640×360 (a portrait in 360×640), the aspect kept, even sides", () => {
  expect(draftSize(1920, 1080)).toEqual([640, 360]);
  expect(draftSize(3840, 2160)).toEqual([640, 360]);
  expect(draftSize(2160, 3840)).toEqual([360, 640]);
  expect(draftSize(4096, 4096)).toEqual([360, 360]);
  expect(draftSize(1001, 333)).toEqual([640, 212]);
  // (never larger than the final)
  expect(draftSize(320, 180)).toEqual([320, 180]);
  expect(draftSize(10, 10)).toEqual([16, 16]);
});

test("frames and names", () => {
  expect(videoFrames(10, 24)).toBe(240);
  expect(videoFrames(0.01, 24)).toBe(1);
  expect(videoName("kerr", "orbit", 12.4, 30, true, "webm")).toBe("kerr-orbit-12s-30fps-draft.webm");
  expect(videoName("kerr", "live", 24, 24, false, "mp4")).toBe("kerr-live-24s-24fps.mp4");
});
