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
        items.append([
            "text": top.string,
            "box": [
                "x": Double(box.origin.x),
                "y": Double(box.origin.y),
                "w": Double(box.size.width),
                "h": Double(box.size.height)
            ]
        ])
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
