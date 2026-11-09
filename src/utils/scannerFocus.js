const clamp = (value) => Math.max(0, Math.min(1, value));

export function updateScannerCameraConstraints(track, settings, removeKeys = Object.keys(settings)) {
  const previous = track.getConstraints?.() || {};
  const omit = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !removeKeys.includes(key)));
  const { advanced = [], ...base } = previous;
  const retained = advanced.map(omit).filter((item) => Object.keys(item).length);
  return track.applyConstraints({ ...omit(base), advanced: [...retained, settings] });
}

// Preview uses object-fit: cover, centered. Map the visible point back to the
// full video frame instead of focusing in the cropped-away part of the sensor.
export function getFocusPoint(rect, width, height, clientX, clientY) {
  const display = {
    x: rect.width > 0 ? clamp((clientX - rect.left) / rect.width) : 0.5,
    y: rect.height > 0 ? clamp((clientY - rect.top) / rect.height) : 0.5
  };
  if (!width || !height || !rect.width || !rect.height) return { display, sensor: display };
  const scale = Math.max(rect.width / width, rect.height / height);
  return {
    display,
    sensor: {
      x: clamp((display.x * rect.width + (width * scale - rect.width) / 2) / (width * scale)),
      y: clamp((display.y * rect.height + (height * scale - rect.height) / 2) / (height * scale))
    }
  };
}

export async function requestScannerFocus(track, point, supported = {}) {
  if (!track || track.readyState === "ended") return { supported: false };
  const modes = track.getCapabilities?.().focusMode || [];
  const mode = modes.includes("continuous") ? "continuous" : modes.includes("single-shot") ? "single-shot" : null;
  if (!mode) return { supported: false };

  // applyConstraints replaces previous constraints. Retain zoom, torch and
  // resolution while replacing only the focus settings.
  const apply = async (usePoint) => {
    if (track.readyState === "ended") return;
    await updateScannerCameraConstraints(track,
      { focusMode: mode, ...(usePoint ? { pointsOfInterest: [point] } : {}) },
      ["focusMode", "pointsOfInterest", "focusDistance"]);
    const actual = track.getSettings?.().focusMode;
    if (actual && actual !== mode) throw new Error("A camera nao aceitou o ajuste de foco.");
  };
  let pointRequested = Boolean(point && supported.pointsOfInterest);
  try {
    await apply(pointRequested);
  } catch (error) {
    if (!pointRequested || track.readyState === "ended") throw error;
    pointRequested = false;
    await apply(false);
  }
  return { supported: true, pointRequested, mode };
}
