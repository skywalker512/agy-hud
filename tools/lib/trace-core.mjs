/**
 * Barrel entrypoint for AGY-HUD execution trace capture, anomaly detection,
 * replay, timeline rendering, and PII-redacted fixture export.
 */
export { detectFrameAnomalies } from './trace/anomalies.mjs';
export {
  callLsRpc,
  discoverLsConnection,
  isPidAlive,
  resolveDataDir,
} from './trace/ls-probe.mjs';
export { TraceRecorder } from './trace/recorder.mjs';
export {
  createUuidAnonymizer,
  exportTraceFixture,
  redactProtobufBlob,
} from './trace/redact.mjs';
export {
  buildTimelineFromDb,
  buildTimelineFromTrace,
  loadTraceFile,
  replayTrace,
} from './trace/replay.mjs';
export {
  compactLsStepForTrace,
  DB_STEP_STATUS_NAMES,
  DB_STEP_TYPE_NAMES,
  decodeErrorStepPayload,
  decodeToolErrorPayload,
  evaluateHudFromDbAndLs,
  mergeTelemetryWithLiveOverlay,
  summarizeDbStep,
  TRACE_SCHEMA_VERSION,
} from './trace/step-decoder.mjs';
