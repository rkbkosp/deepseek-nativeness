import { createHash } from "node:crypto";
// A UI preference partition, never an authorization decision. No bearer material participates.
export function preferenceIdentityScope(serverUrl, credentials, deviceId) {
  if (!credentials) return "";
  const principal = credentials.account
    ? ["account", credentials.account]
    : ["device", deviceId, credentials.authorizationMethod];
  return (
    "sha256:" +
    createHash("sha256")
      .update(JSON.stringify([serverUrl, principal]))
      .digest("hex")
  );
}
