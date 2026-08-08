import assert from "node:assert/strict";
import test from "node:test";

import {
  NTRIP_PROVIDER_RTK2GO,
  resolveNtripProviderSettings,
  validateNtripProviderAccount,
} from "../../../js/rtk/ntripProviders.js";

test("RTK2go preset resolves to the native public caster endpoint", () => {
  const settings = resolveNtripProviderSettings({
    provider: NTRIP_PROVIDER_RTK2GO,
    host: "wrong.example",
    port: 443,
    tls: true,
  });
  assert.equal(settings.host, "rtk2go.com");
  assert.equal(settings.port, 2101);
  assert.equal(settings.tls, false);
});

test("RTK2go stream connection requires its valid-email username", () => {
  assert.throws(
    () => validateNtripProviderAccount({ provider: NTRIP_PROVIDER_RTK2GO }),
    /valid email address/,
  );
  const settings = validateNtripProviderAccount({
    provider: NTRIP_PROVIDER_RTK2GO,
    username: " pilot@example.com ",
  });
  assert.equal(settings.username, "pilot@example.com");
});

