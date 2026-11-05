// Q6-ISS ISS0 — the Sen live stream's overlay read (docs/progress/refraction-horizons/Q6-ISS.md): its "TIME UTC" and "ALTITUDE km"
// fields, by macOS's Vision text recognition on the lower right block of each 1920×1080 frame. One line a frame on stdout:
// file, overlay time (hh:mm:ss or "-"), altitude [km] (or "-"). Usage: swift scripts/iss-overlay-ocr.swift <frame.jpg> …
import AppKit
import Foundation
import Vision

func read(_ path: String) -> (String, String) {
  guard let img = NSImage(contentsOfFile: path),
    let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
  else { return ("-", "-") }
  // (the block of the time, sunset and altitude: x 1420–1720, y 930–1060 on a 1080p frame — scaled to the frame's size)
  let sx = Double(cg.width) / 1920, sy = Double(cg.height) / 1080
  let rect = CGRect(x: 1420 * sx, y: 930 * sy, width: 300 * sx, height: 130 * sy)
  guard let crop = cg.cropping(to: rect) else { return ("-", "-") }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: crop, options: [:]).perform([req])
  // (each field's label and value on one row: a value taken by its label's row — the third row is not always the altitude:
  // the stream shows other figures there now and then)
  let obs = (req.results ?? []).compactMap { o -> (String, CGFloat)? in
    guard let s = o.topCandidates(1).first?.string else { return nil }
    return (s, o.boundingBox.midY)
  }
  func value(_ label: String, _ pattern: String) -> String {
    guard let l = obs.first(where: { $0.0.uppercased().contains(label) }) else { return "-" }
    let row = obs.filter { abs($0.1 - l.1) < 0.12 }.map { $0.0 }.joined(separator: " ")
    return row.range(of: pattern, options: .regularExpression).map { String(row[$0]) } ?? "-"
  }
  return (value("TIME", #"\d{2}:\d{2}:\d{2}"#), value("ALTITUDE", #"\d{3}\.\d{1,2}"#))
}

for path in CommandLine.arguments.dropFirst() {
  let (t, a) = read(path)
  print("\((path as NSString).lastPathComponent)\t\(t)\t\(a)")
}
