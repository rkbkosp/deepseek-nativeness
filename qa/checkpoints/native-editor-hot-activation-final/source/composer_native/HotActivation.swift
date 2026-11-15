import AppKit
import Foundation
import CoreFoundation

private let activationAckLimit = 8 * 1024
private let nativeFrameLimit = 1024 * 1024
private func activationInteger(_ value: Any?) -> UInt64? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return UInt64(number.stringValue)
}
private func boundedIdentity(_ value: String, _ maximum: Int, empty: Bool = false) -> Bool {
    (empty || !value.isEmpty) && value.utf8.count <= maximum && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
}
private func activationHeader(_ owner: ComposerOwner, kind: String, error: String? = nil) -> [String: Any] {
    var result: [String: Any] = ["kind": kind, "id": owner.id, "epoch": owner.epoch, "docKey": owner.docKey,
        "accountScope": owner.accountScope, "revision": owner.revision, "semanticRevision": owner.semanticRevision,
        "semanticDigest": owner.semanticDigest]
    if let error { result["error"] = error; result["invalid"] = true }
    return result
}

// A large native body never crosses the FFI merely to recover its revision.
// The body and undo remain native; this is only a monotonic invalid fence.
func boundedComposerJSON(_ value: [String: Any], owner: ComposerOwner) -> Data {
    let full = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    if let full, full.count <= nativeFrameLimit { return full }
    let header = activationHeader(owner, kind: "invalid", error: full == nil ? "NATIVE_FRAME_INVALID_JSON" : "NATIVE_FRAME_TOO_LARGE")
    if let data = try? JSONSerialization.data(withJSONObject: header, options: [.sortedKeys]), data.count <= activationAckLimit { return data }
    return try! JSONSerialization.data(withJSONObject: ["kind": "invalid", "id": owner.id, "revision": owner.revision,
        "invalid": true, "error": "NATIVE_HEADER_TOO_LARGE"], options: [.sortedKeys])
}

extension ComposerOwner {
    // Caller is command(), already suppressing callbacks for the complete
    // transaction. All identity/target/encoding failures precede every mutation.
    func activateHotDocument(_ request: [String: Any]) -> [String: Any] {
        guard let sourceEpoch = request["epoch"] as? String, let sourceKey = request["docKey"] as? String,
              let sourceAccount = request["accountScope"] as? String,
              boundedIdentity(sourceEpoch, 256, empty: true), boundedIdentity(sourceKey, 2048, empty: true),
              boundedIdentity(sourceAccount, 512, empty: true),
              let targetKey = request["targetDocKey"] as? String, boundedIdentity(targetKey, 2048),
              let targetAccount = request["targetAccountScope"] as? String, boundedIdentity(targetAccount, 512),
              let namespace = request["activationNamespace"] as? String, namespace.utf8.count == 32,
              namespace.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (97...102).contains($0.value) }),
              let generation = activationInteger(request["expectedActivationGeneration"]),
              let afterRevision = activationInteger(request["afterRevision"]),
              let requestID = activationInteger(request["id"]) else { return ["error": "INVALID_ACTIVATION_IDENTITY"] }
        guard requestID == id, sourceEpoch == epoch, sourceKey == docKey, sourceAccount == accountScope else { return ["error": "STALE_ACTIVATION_SOURCE"] }
        guard generation == activationGeneration, activationNamespace.isEmpty || activationNamespace == namespace else { return ["error": "STALE_ACTIVATION_GENERATION"] }
        guard revision >= 0, UInt64(revision) >= afterRevision else { return ["error": "STALE_ACTIVATION_REVISION"] }
        guard activationGeneration < UInt64.max, revision < Int.max else { return ["error": "ACTIVATION_GENERATION_EXHAUSTED"] }
        let sameDocument = targetKey == docKey
        let retained = sameDocument ? nil : savedDocuments[targetKey]
        guard sameDocument || retained != nil else { return ["error": "HOT_DOCUMENT_MISSING"] }
        guard (sameDocument ? accountScope : retained!.accountScope) == targetAccount else { return ["error": "HOT_DOCUMENT_ACCOUNT_MISMATCH"] }
        let content: NSAttributedString = sameDocument ? (text.textStorage ?? NSAttributedString(string: "")) : retained!.content
        let selection = sameDocument ? text.selectedRange() : retained!.selection
        guard selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= content.length, selection.length <= content.length - selection.location,
              draftUTF16Boundary(content.string, selection.location), draftUTF16Boundary(content.string, selection.location + selection.length) else { return ["error": "HOT_DOCUMENT_SELECTION_INVALID"] }
        let digest = sameDocument ? draftSemanticDigest(runs()) : retained!.semanticDigest
        guard !sameDocument || digest == semanticDigest || semanticRevision < UInt64.max else { return ["error": "ACTIVATION_GENERATION_EXHAUSTED"] }
        let contentRevision = sameDocument ? semanticRevision + (digest == semanticDigest ? 0 : 1) : retained!.semanticRevision
        guard contentRevision > 0, digest.utf8.count == 64,
              digest.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (97...102).contains($0.value) }) else { return ["error": "INVALID_HOT_SEMANTIC_METADATA"] }
        let nextGeneration = activationGeneration + 1
        let nextEpoch = "native-hot:\(namespace):\(nextGeneration)"
        guard nextEpoch != epoch else { return ["error": "ACTIVATION_EPOCH_CONFLICT"] }
        let ack: [String: Any] = ["kind": "hotActivated", "id": id, "epoch": nextEpoch, "docKey": targetKey,
            "accountScope": targetAccount, "revision": revision + 1, "semanticRevision": contentRevision,
            "semanticDigest": digest, "activationGeneration": nextGeneration, "requiresSnapshot": true]
        guard let encoded = try? JSONSerialization.data(withJSONObject: ack, options: [.sortedKeys]), encoded.count <= activationAckLimit else { return ["error": "ACTIVATION_ACK_TOO_LARGE"] }
        if !sameDocument {
            text.breakUndoCoalescing(); text.unmarkText(); text.clearSelectedCommand()
            saveCurrentDocument()
            text.textStorage?.setAttributedString(content); documentUndo = retained!.undo
            appliedCommits = retained!.appliedCommits
            savedDocuments.removeValue(forKey: targetKey)
            applyGlobalStyle(); text.setSelectedRange(selection)
        }
        epoch = nextEpoch; docKey = targetKey; accountScope = targetAccount
        semanticRevision = contentRevision; semanticDigest = digest
        activationNamespace = namespace; activationGeneration = nextGeneration; revision += 1
        return ack
    }
}
