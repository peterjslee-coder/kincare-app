// ─── HubPersonCheck (v1.160.0) — "is a person here?" on the tablet itself ───
//
// Pete, 11/25: the Hub's history showed Betty "up" all night. It was counting the TV: its
// sound as talking, its picture as movement. "How do we make it look for a person and not just
// 'I hear noise'?" ... "Can we train it what a tv looks ... like too?"
//
// A small ready-made object detector (Google's EfficientDet-Lite0, trained on the public COCO
// photo set: "person", "tv", "laptop" and ~80 other everyday things) runs INSIDE the tablet's
// web view through MediaPipe. It is given one camera frame, returns labelled boxes, and the
// frame is thrown away. Nothing is stored or sent: only yes/no leaves the tablet (HubAwake).
//
// The rule (judge): a person counts only if they are NOT inside a screen's box — so a person on
// the TV, or on a laptop or phone screen in view, is not Betty. The screens' boxes are also
// returned so HubAwake can ignore movement inside them.
//
// Self-hosted under /vendor/mediapipe-1.2.3 (README there). Plain script, no JSX, so the
// end-to-end check (tests/hubPersonCheck.e2e.js) loads this same file in a real browser.
(function () {
  const BASE = '/vendor/mediapipe-1.2.3';
  const PERSON_MIN = 0.45;  // detector confidence to call something a person (a real lap photo scored 0.497)
  const SCREEN_MIN = 0.3;   // ...and to call something a screen
  const INSIDE_SCREEN = 0.6; // a person box this much inside a screen box is ON the screen
  const SCREENS = new Set(['tv', 'laptop', 'cell phone']);
  let state = 'idle'; // idle | loading | ready | failed
  let detector = null;
  let loading = null;

  function load() {
    if (detector) return Promise.resolve(detector);
    if (loading) return loading;
    state = 'loading';
    // A real dynamic import, kept out of the Babel build's reach.
    const importer = new Function('u', 'return import(u)'); // eslint-disable-line no-new-func
    loading = (async () => {
      const mp = await importer(BASE + '/vision_bundle.mjs');
      const fileset = await mp.FilesetResolver.forVisionTasks(BASE + '/wasm');
      detector = await mp.ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: BASE + '/efficientdet_lite0.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: SCREEN_MIN,
        maxResults: 15,
      });
      state = 'ready';
      return detector;
    })().catch((e) => { state = 'failed'; loading = null; throw e; });
    return loading;
  }

  // Share of box a's area that lies inside box b.
  function inside(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return a.w * a.h > 0 ? inter / (a.w * a.h) : 0;
  }

  /**
   * detections (MediaPipe shape) → { person, people, onScreen, screens: [normalized boxes] }
   * known: screens remembered from earlier frames (normalized). A TV doesn't move, but the
   * detector doesn't see it in every frame — in a test photo a person shown on a tablet's
   * screen counted because that frame missed the tablet. Remembered screens close that gap.
   */
  function judge(detections, width, height, known) {
    const boxes = (detections || []).map((d) => {
      const c = d.categories && d.categories[0];
      const b = d.boundingBox || {};
      return { label: c ? c.categoryName : '', score: c ? c.score : 0, x: b.originX || 0, y: b.originY || 0, w: b.width || 0, h: b.height || 0 };
    });
    const screens = boxes.filter((b) => SCREENS.has(b.label) && b.score >= SCREEN_MIN);
    const people = boxes.filter((b) => b.label === 'person' && b.score >= PERSON_MIN);
    const W = width || 1, H = height || 1;
    const remembered = (known || []).map((k) => ({ x: k.x * W, y: k.y * H, w: k.w * W, h: k.h * H }));
    const all = screens.concat(remembered);
    const real = people.filter((p) => !all.some((s) => inside(p, s) >= INSIDE_SCREEN));
    return {
      person: real.length > 0,
      people: real.length,
      onScreen: people.length - real.length,
      screens: screens.map((s) => ({ x: s.x / W, y: s.y / H, w: s.w / W, h: s.h / H })),
      seen: boxes.map((b) => `${b.label} ${Math.round(b.score * 100)}%`), // for the e2e check and the status line
    };
  }

  // ─── Remembered screens ───
  // Boxes are normalized (0..1). A new box that overlaps a remembered one by IoU ≥ 0.4 refreshes
  // it; boxes unseen for 7 days are dropped; at most 6 kept. Pure, so it is unit-tested.
  const KEEP_MS = 7 * 24 * 3600 * 1000;
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }
  function rememberScreens(prev, seen, now) {
    const list = (prev || []).filter((k) => now - (k.at || 0) < KEEP_MS).map((k) => ({ ...k }));
    for (const s of seen || []) {
      const hit = list.find((k) => iou(k, s) >= 0.4);
      if (hit) { hit.x = s.x; hit.y = s.y; hit.w = s.w; hit.h = s.h; hit.at = now; hit.n = (hit.n || 1) + 1; }
      else list.push({ x: s.x, y: s.y, w: s.w, h: s.h, at: now, n: 1 });
    }
    list.sort((a, b) => b.at - a.at);
    return list.slice(0, 6);
  }

  /** One frame (video, image or canvas) → judge(...). Loads the detector the first time. */
  async function check(source, known) {
    const d = await load();
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    const res = d.detect(source);
    return judge(res && res.detections, w, h, known);
  }

  window.HubPersonCheck = { load, check, judge, inside, iou, rememberScreens, state: () => state, PERSON_MIN, SCREEN_MIN };
})();
