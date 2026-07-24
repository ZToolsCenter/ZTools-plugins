import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private let maximumRequestBytes = 8 * 1024

private struct Request: Codable {
    let requestId: String
    let imagePath: String
}

private struct Response: Codable {
    let requestId: String
    let ok: Bool
    let text: String?
    let error: String?
}

private func emit(_ response: Response) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(response),
          let line = String(data: data, encoding: .utf8) else {
        FileHandle.standardOutput.write(Data("{\"requestId\":\"unknown\",\"ok\":false,\"error\":\"encoding failed\"}\n".utf8))
        return
    }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

private func fail(_ requestId: String, _ message: String) -> Never {
    emit(Response(requestId: requestId, ok: false, text: nil, error: message))
    exit(1)
}

guard let line = readLine(strippingNewline: true) else {
    fail("unknown", "missing request")
}
guard let data = line.data(using: .utf8), data.count <= maximumRequestBytes else {
    fail("unknown", "request exceeds 8 KiB")
}
guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      Set(json.keys) == Set(["requestId", "imagePath"]),
      let request = try? JSONDecoder().decode(Request.self, from: data) else {
    fail("unknown", "invalid request envelope")
}
guard !request.requestId.isEmpty else {
    fail("unknown", "requestId is required")
}
guard request.imagePath.hasPrefix("/") else {
    fail(request.requestId, "imagePath must be absolute")
}

var isDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: request.imagePath, isDirectory: &isDirectory),
      !isDirectory.boolValue else {
    fail(request.requestId, "image file does not exist")
}

let imageURL = URL(fileURLWithPath: request.imagePath, isDirectory: false) as CFURL
guard let source = CGImageSourceCreateWithURL(imageURL, nil),
      let sourceType = CGImageSourceGetType(source),
      let uniformType = UTType(sourceType as String),
      uniformType.conforms(to: .image),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail(request.requestId, "input is not a supported image")
}

let recognition = VNRecognizeTextRequest()
recognition.recognitionLevel = .accurate
recognition.usesLanguageCorrection = true

do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([recognition])
    let text = (recognition.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: "\n")
    emit(Response(requestId: request.requestId, ok: true, text: text, error: nil))
} catch {
    fail(request.requestId, "vision recognition failed")
}
