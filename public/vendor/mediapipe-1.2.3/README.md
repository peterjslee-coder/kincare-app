# MediaPipe Tasks Vision 1.2.3 + EfficientDet-Lite0 (v1.160.0)

Self-hosted for the InPlace Hub's on-tablet person check (RecipientPhone.js `HubAwake`).
Nothing here is sent anywhere: the model runs inside the tablet's web view.

- `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}`: npm `@mediapipe/tasks-vision@1.2.3`
  (Apache-2.0, Google).
- `efficientdet_lite0.tflite`: Google's EfficientDet-Lite0 COCO object detector (Apache-2.0),
  taken from npm `ptmaker-vision-models@1.0.0` because storage.googleapis.com was unreachable from
  the build sandbox. Checked: its embedded `labels.txt` is the 90-line COCO map ("person" 0,
  "tv" 71, "laptop" 72), and it detects people in a real photo (tests/hubPersonCheck.e2e.js).
  sha256 4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993
