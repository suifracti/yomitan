// SPDX-License-Identifier: GPL-3.0-or-later
// On-device caption translation through Apple's Translation framework (macOS 26+).
// Reads {"source","target","texts"} JSON on stdin and writes {"translations"} or
// {"error","code"} on stdout. Nothing leaves the Mac; a missing language pack is
// reported instead of downloaded, because downloads need the system UI.
import Foundation
import Translation

struct Input: Decodable { let source: String; let target: String; let texts: [String] }
struct Output: Encodable { var translations: [String]? = nil; var error: String? = nil; var code: String? = nil }

func emit(_ output: Output, _ status: Int32) -> Never {
    let data = (try? JSONEncoder().encode(output)) ?? Data("{\"code\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
    exit(status)
}

@main
struct AppleTranslate {
    static func main() async {
        guard let input = try? JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile()),
              !input.texts.isEmpty, input.texts.count <= 8 else {
            emit(Output(error: "输入无效", code: "input"), 2)
        }
        let source = Locale.Language(identifier: input.source)
        let target = Locale.Language(identifier: input.target)
        // "supported" can still translate when the system has the model cached, so try first.
        let status = await LanguageAvailability().status(from: source, to: target)
        if status == .unsupported { emit(Output(error: "不支持这组语言", code: "unsupported"), 4) }
        let session = TranslationSession(installedSource: source, target: target)
        let requests = input.texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
        do {
            var result = Array(repeating: "", count: input.texts.count)
            for response in try await session.translations(from: requests) {
                if let id = response.clientIdentifier, let index = Int(id), result.indices.contains(index) { result[index] = response.targetText }
            }
            emit(Output(translations: result), 0)
        } catch {
            emit(Output(error: error.localizedDescription, code: status == .installed ? "failed" : "download"), status == .installed ? 5 : 3)
        }
    }
}
