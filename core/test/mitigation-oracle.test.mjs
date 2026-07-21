import assert from "node:assert/strict";
import test from "node:test";
import { MitigationOracle } from "../dist/index.js";

function setupContext(inScopeServices) {
  return {
    ci: { green: true },
    deploy: { redeployed: true },
    mitigation: {
      alertToClear: "TargetAlert",
      maxClearTimeSeconds: 10,
      sustainedClearSeconds: 1,
      inScopeServices,
    },
  };
}

class FakeProbe {
  constructor(firingAlertsList) {
    this.alerts = firingAlertsList;
    this.currentTime = 1000;
  }
  async isFiring(alertName) {
    return false; // Target always clears immediately
  }
  async firingAlerts() {
    return this.alerts;
  }
  now() {
    // advance time to pass sustainedClearSeconds
    this.currentTime += 2000;
    return this.currentTime;
  }
}

test("scoped: out-of-scope alert ignored", async () => {
  const probe = new FakeProbe([{ alertName: "BookMetadataTrafficStalled", service: "book-metadata" }]);
  const oracle = new MitigationOracle({ probe, pollIntervalMs: 1 });
  const ctx = setupContext(["booklogr-api"]);
  const score = await oracle.evaluate(ctx);
  const sig = score.signals.find((s) => s.id === "no_new_alerts");
  assert.equal(sig.value, 1);
});

test("scoped: in-scope alert counts", async () => {
  const probe = new FakeProbe([{ alertName: "BookMetadataTrafficStalled", service: "book-metadata" }]);
  const oracle = new MitigationOracle({ probe, pollIntervalMs: 1 });
  const ctx = setupContext(["booklogr-api", "book-metadata"]);
  const score = await oracle.evaluate(ctx);
  const sig = score.signals.find((s) => s.id === "no_new_alerts");
  assert.equal(sig.value, 0);
});

test("unscoped legacy", async () => {
  const probe = new FakeProbe([{ alertName: "AnyAlert", service: "some-service" }]);
  const oracle = new MitigationOracle({ probe, pollIntervalMs: 1 });
  const ctx = setupContext(undefined);
  const score = await oracle.evaluate(ctx);
  const sig = score.signals.find((s) => s.id === "no_new_alerts");
  assert.equal(sig.value, 0);
});

test("alert without a service label under a defined scope is ignored", async () => {
  const probe = new FakeProbe([{ alertName: "LabelLessAlert" }]); // no service field
  const oracle = new MitigationOracle({ probe, pollIntervalMs: 1 });
  const ctx = setupContext(["booklogr-api"]);
  const score = await oracle.evaluate(ctx);
  const sig = score.signals.find((s) => s.id === "no_new_alerts");
  assert.equal(sig.value, 1);
});
