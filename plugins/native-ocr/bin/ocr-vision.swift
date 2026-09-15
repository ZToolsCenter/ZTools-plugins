import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("Usage: ocr-vision <image-path>\n".data(using: .utf8)!)
    exit(2)
}

let imagePath = CommandLine.arguments[1]
let url = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: url),
      let tiffData = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    FileHandle.standardError.write("无法加载图片: \(imagePath)\n".data(using: .utf8)!)
    exit(3)
}

let request = VNRecognizeTextRequest { req, err in
    if let err = err {
        FileHandle.standardError.write("识别失败: \(err.localizedDescription)\n".data(using: .utf8)!)
        exit(4)
    }
    guard let observations = req.results as? [VNRecognizedTextObservation] else { return }

    var items: [[String: Any]] = []
    for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        let box = obs.boundingBox
        var entry: [String: Any] = [
            "text": top.string,
            "box": [
                "x": Double(box.origin.x),
                "y": Double(box.origin.y),
                "w": Double(box.size.width),
                "h": Double(box.size.height)
            ]
        ]
        // 逐字符框：图文混排（mixed）需要它把「整行 observation」按公式区间切开，
        // 否则含行内公式的整行只能被当成一段文本，公式顺序无法正确交错。
        // 坐标与 boundingBox 同属「归一化 0..1、原点左下」。
        // 超长行（>240 字符）跳过，避免逐字符调用 Vision 造成的额外开销。
        let str = top.string
        if str.count <= 240 && !str.isEmpty {
            var chars: [[String: Any]] = []
            var idx = str.startIndex
            while idx < str.endIndex {
                let next = str.index(after: idx)
                var ch: [String: Any] = ["c": String(str[idx..<next])]
                if let cb = try? top.boundingBox(for: idx..<next) {
                    ch["box"] = [
                        "x": Double(cb.boundingBox.origin.x),
                        "y": Double(cb.boundingBox.origin.y),
                        "w": Double(cb.boundingBox.size.width),
                        "h": Double(cb.boundingBox.size.height)
                    ]
                }
                chars.append(ch)
                idx = next
            }
            entry["chars"] = chars
        }
        items.append(entry)
    }

    guard let data = try? JSONSerialization.data(withJSONObject: items, options: []),
          let json = String(data: data, encoding: .utf8) else {
        FileHandle.standardError.write("识别结果序列化失败\n".data(using: .utf8)!)
        exit(4)
    }
    FileHandle.standardOutput.write((json + "\n").data(using: .utf8)!)
}
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("执行失败: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(5)
}
