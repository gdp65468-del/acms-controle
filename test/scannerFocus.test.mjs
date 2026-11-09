import assert from "node:assert/strict";
import test from "node:test";
import { getFocusPoint, requestScannerFocus, updateScannerCameraConstraints } from "../src/utils/scannerFocus.js";

function camera(modes, previous = {}) {
  let constraints = previous;
  let mode;
  const calls = [];
  return {
    calls,
    readyState: "live",
    getCapabilities: () => ({ focusMode: modes }),
    getSettings: () => ({ focusMode: mode }),
    getConstraints: () => constraints,
    async applyConstraints(next) {
      calls.push(next);
      constraints = next;
      mode = next.advanced.findLast((item) => item.focusMode)?.focusMode;
    }
  };
}

test("toque considera o recorte cover em retrato e paisagem", () => {
  const rect = { left: 10, top: 20, width: 300, height: 600 };
  const portrait = getFocusPoint(rect, 1920, 1080, 10, 320);
  assert.equal(portrait.display.x, 0);
  assert.equal(portrait.sensor.y, 0.5);
  assert.ok(Math.abs(portrait.sensor.x - 0.359375) < 0.00001);
  const landscape = getFocusPoint({ left: 0, top: 0, width: 600, height: 300 }, 1080, 1920, 300, 0);
  assert.equal(landscape.sensor.x, 0.5);
  assert.ok(Math.abs(landscape.sensor.y - 0.359375) < 0.00001);
  assert.deepEqual(getFocusPoint(rect, 1920, 1080, 160, 320).sensor, { x: 0.5, y: 0.5 });
});

test("foco continuo usa sequencia de pontos e preserva zoom, lanterna e resolucao", async () => {
  const track = camera(["single-shot", "continuous"], {
    width: { ideal: 1920 }, advanced: [{ zoom: 2, torch: true, focusMode: "manual", focusDistance: 10 }]
  });
  const result = await requestScannerFocus(track, { x: 0.3, y: 0.6 }, { pointsOfInterest: true });
  assert.equal(result.mode, "continuous");
  assert.equal(result.pointRequested, true);
  assert.deepEqual(track.calls[0], {
    width: { ideal: 1920 },
    advanced: [{ zoom: 2, torch: true }, { focusMode: "continuous", pointsOfInterest: [{ x: 0.3, y: 0.6 }] }]
  });
  await updateScannerCameraConstraints(track, { zoom: 1 });
  assert.deepEqual(track.calls[1].advanced, [
    { torch: true }, { focusMode: "continuous", pointsOfInterest: [{ x: 0.3, y: 0.6 }] }, { zoom: 1 }
  ]);
});

test("camera sem ponto de interesse recebe somente foco; camera fixa nao recebe comando", async () => {
  const automatic = camera(["single-shot"]);
  assert.equal((await requestScannerFocus(automatic, { x: 0.2, y: 0.4 })).pointRequested, false);
  assert.deepEqual(automatic.calls[0].advanced, [{ focusMode: "single-shot" }]);
  const fixed = camera(["none", "manual"]);
  assert.equal((await requestScannerFocus(fixed)).supported, false);
  assert.equal(fixed.calls.length, 0);
});

test("ponto rejeitado tenta novamente somente com autofocus", async () => {
  const track = camera(["continuous"]);
  const apply = track.applyConstraints;
  let attempts = 0;
  track.applyConstraints = async (next) => {
    attempts++;
    if (next.advanced.some((item) => item.pointsOfInterest)) throw new Error("unsupported point");
    await apply(next);
  };
  const result = await requestScannerFocus(track, { x: 0.2, y: 0.4 }, { pointsOfInterest: true });
  assert.equal(attempts, 2);
  assert.equal(result.pointRequested, false);
});

test("foco ignorado ou rejeitado nao e reportado como aplicado", async () => {
  const track = camera(["continuous"]);
  track.getSettings = () => ({ focusMode: "manual" });
  await assert.rejects(requestScannerFocus(track), /nao aceitou/);
  track.applyConstraints = async () => { throw new Error("camera failure"); };
  await assert.rejects(requestScannerFocus(track), /camera failure/);
});

test("camera encerrada nao recebe novos ajustes", async () => {
  const track = camera(["continuous"]);
  track.readyState = "ended";
  assert.equal((await requestScannerFocus(track)).supported, false);
  assert.equal(track.calls.length, 0);
});
