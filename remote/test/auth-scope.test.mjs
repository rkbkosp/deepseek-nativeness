import { test } from "node:test";
import assert from "node:assert/strict";
import { preferenceIdentityScope } from "../auth-scope.mjs";
test("private UI scope separates server/account and ignores refreshed bearer credentials", () => {
  const account = {
    account: "fixture@example.invalid",
    authorizationMethod: "account",
    accessToken: "old",
    refreshToken: "old",
  };
  const a = preferenceIdentityScope(
    "https://fixture.invalid",
    account,
    "device",
  );
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
  assert.ok(!a.includes(account.account));
  assert.equal(
    a,
    preferenceIdentityScope(
      "https://fixture.invalid",
      { ...account, accessToken: "new", refreshToken: "new" },
      "rotated-device",
    ),
  );
  assert.notEqual(
    a,
    preferenceIdentityScope(
      "https://fixture.invalid",
      { ...account, account: "another@example.invalid" },
      "device",
    ),
  );
  assert.notEqual(
    a,
    preferenceIdentityScope("https://other.invalid", account, "device"),
  );
  assert.equal(
    preferenceIdentityScope("https://fixture.invalid", undefined, "device"),
    "",
  );
});
