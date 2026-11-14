"""Zero-dependency unit tests for desktop.telemetry and desktop.cli."""

import contextlib
import io
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from desktop import cli
from desktop.telemetry import (
    TelemetryStore,
    TurnRecord,
    _resolve_context_limit,
    decode_generation_record,
    fmt_count,
    fmt_tps,
    iter_fields,
    read_duration_sec,
    read_varint,
)


def _encode_varint(value: int) -> bytes:
    out = bytearray()
    n = int(value)
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


def _v_field(field_num: int, value: int) -> bytes:
    return _encode_varint((field_num << 3) | 0) + _encode_varint(value)


def _b_field(field_num: int, payload: bytes) -> bytes:
    return _encode_varint((field_num << 3) | 2) + _encode_varint(len(payload)) + payload


def _duration_msg(sec_float: float) -> bytes:
    sec = int(sec_float)
    nanos = int(round((sec_float - sec) * 1_000_000_000))
    parts = []
    if sec > 0:
        parts.append(_v_field(1, sec))
    if nanos > 0:
        parts.append(_v_field(2, nanos))
    return b"".join(parts)


def _build_gen_blob(
    model_id: str = "gemini-4-carbon",
    model_display: str = "Gemini 4 Carbon",
    cached: int = 80_000,
    new_in: int = 4_000,
    output: int = 400,
    thinking: int = 150,
    visible: int = 250,
    reported_ctx: int = 84_000,
    ctx_limit: int = 0,
    ttft_sec: float = 3.0,
    stream_sec: float = 8.0,
) -> bytes:
    usage = b"".join(
        [
            _v_field(2, new_in),
            _v_field(3, output),
            _v_field(5, cached),
            _v_field(9, thinking),
            _v_field(10, visible),
        ]
    )
    ctx_inner = _v_field(1, reported_ctx) + (_v_field(4, ctx_limit) if ctx_limit > 0 else b"")
    inner = b"".join(
        [
            _b_field(4, usage),
            _b_field(9, _b_field(10, ctx_inner)),
            _b_field(11, _duration_msg(ttft_sec)),
            _b_field(12, _duration_msg(stream_sec)),
            _b_field(19, model_id.encode("utf-8")),
            _b_field(21, model_display.encode("utf-8")),
        ]
    )
    return _b_field(1, inner)


class TelemetryTests(unittest.TestCase):
    def test_protobuf_decoders(self):
        raw = _encode_varint(256_000)
        val, pos = read_varint(raw, 0)
        self.assertEqual(val, 256_000)
        self.assertEqual(pos, len(raw))

        dur = _duration_msg(12.345)
        self.assertAlmostEqual(read_duration_sec(dur), 12.345, places=6)
        self.assertEqual(len(list(iter_fields(dur))), 2)

        rec = decode_generation_record(_build_gen_blob())
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertEqual(rec.preferred_model, "gemini-4-carbon")
        self.assertEqual(rec.output_tokens, 400)
        self.assertFalse(rec.is_buffered)

        # Ensure fnum=1 in usage (model_enum) never overwrites output_tokens
        usage_with_model_enum = _v_field(1, 1037) + _v_field(2, 500) + _v_field(5, 10_000)
        blob_with_enum = _b_field(
            1,
            _b_field(4, usage_with_model_enum)
            + _b_field(19, b"gemini-4-carbon")
            + _b_field(21, b"Gemini 4 Carbon"),
        )
        rec_enum = decode_generation_record(blob_with_enum)
        self.assertIsNotNone(rec_enum)
        assert rec_enum is not None
        self.assertEqual(rec_enum.output_tokens, 0)

    def test_context_limit_pattern_fallbacks(self):
        def make_turn(model_id: str) -> TurnRecord:
            rec = decode_generation_record(_build_gen_blob(model_id=model_id, model_display="", ctx_limit=0))
            assert rec is not None
            return rec

        self.assertEqual(_resolve_context_limit(make_turn("gemini-4-carbon-high")), 256_000)
        self.assertEqual(_resolve_context_limit(make_turn("claude-4-sonnet-thinking")), 200_000)
        self.assertEqual(_resolve_context_limit(make_turn("gemini-3.1-pro-preview")), 1_048_576)

    def test_avg_gen_tps_excludes_buffered_turns_and_env_override_works(self):
        with tempfile.TemporaryDirectory() as app_dir:
            conv_dir = os.path.join(app_dir, "conversations")
            os.makedirs(conv_dir, exist_ok=True)
            db_path = os.path.join(conv_dir, "ff88a419-709a-4a6c-8906-05213320d9a5.db")

            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);")
            conn.execute(
                "CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB);"
            )
            # Sustained turn: 400 tok in 8.0s = 50.0 tok/s
            conn.execute(
                "INSERT INTO gen_metadata (idx, data) VALUES (?, ?);",
                (0, _build_gen_blob(output=400, ttft_sec=2.0, stream_sec=8.0)),
            )
            # Single-packet buffered turn: 300 tok in 0.002s (would inflate naive avg to 87.48 > peak 50.0!)
            conn.execute(
                "INSERT INTO gen_metadata (idx, data) VALUES (?, ?);",
                (1, _build_gen_blob(output=300, ttft_sec=5.0, stream_sec=0.002)),
            )
            # Terminal canceled step (status=5) must not report as generating/tool running
            conn.execute(
                "INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, ?, ?, ?);",
                (0, 15, 5, _b_field(1, _duration_msg(1_700_000_000.0))),
            )
            conn.commit()
            conn.close()

            with mock.patch.dict(os.environ, {"ANTIGRAVITY_APP_DATA_DIR": app_dir}):
                store = TelemetryStore()
                snap = store.read_snapshot()

            self.assertIsNotNone(snap)
            assert snap is not None
            self.assertEqual(snap.context_limit, 256_000)
            self.assertEqual(snap.peak_gen_tps, 50.0)
            self.assertAlmostEqual(snap.avg_gen_tps, 50.0, places=4)
            self.assertLessEqual(snap.avg_gen_tps, snap.peak_gen_tps)
            self.assertFalse(snap.is_generating)
            self.assertFalse(snap.is_tool_running)

            # Verify CLI run_once works cleanly in environments without _tkinter
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = cli.run_once(cli._build_store(app_dir))
            self.assertEqual(rc, 0)
            self.assertIn("gemini-4-carbon", buf.getvalue())

    def test_active_generating_and_checkpoint_steps(self):
        with tempfile.TemporaryDirectory() as app_dir:
            conv_dir = os.path.join(app_dir, "conversations")
            os.makedirs(conv_dir, exist_ok=True)
            db_path = os.path.join(conv_dir, "22222222-3333-4444-5555-666666666666.db")

            conn = sqlite3.connect(db_path)
            conn.execute("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);")
            conn.execute(
                "CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, metadata BLOB);"
            )
            conn.execute("INSERT INTO gen_metadata (idx, data) VALUES (?, ?);", (0, _build_gen_blob()))
            conn.execute(
                "INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, ?, ?, ?);",
                (0, 15, 8, _b_field(6, _duration_msg(1_700_000_000.0))),
            )
            conn.commit()

            with mock.patch.dict(os.environ, {"ANTIGRAVITY_APP_DATA_DIR": app_dir}):
                snap_gen = TelemetryStore().read_snapshot()
            self.assertIsNotNone(snap_gen)
            assert snap_gen is not None
            self.assertTrue(snap_gen.is_generating)
            self.assertFalse(snap_gen.is_tool_running)

            # Active checkpoint step (step_type=23, status=0, startedAt set, no endedAt)
            conn.execute(
                "INSERT INTO steps (idx, step_type, status, metadata) VALUES (?, ?, ?, ?);",
                (1, 23, 0, _b_field(32, _duration_msg(1_700_000_010.0))),
            )
            conn.commit()
            conn.close()

            with mock.patch.dict(os.environ, {"ANTIGRAVITY_APP_DATA_DIR": app_dir}):
                snap_cmp = TelemetryStore().read_snapshot()
            self.assertIsNotNone(snap_cmp)
            assert snap_cmp is not None
            self.assertTrue(snap_cmp.is_generating)
            self.assertFalse(snap_cmp.is_tool_running)

    def test_format_helpers(self):
        self.assertEqual(fmt_count(950), "950")
        self.assertEqual(fmt_count(153_600), "153.6k")
        self.assertEqual(fmt_count(1_048_576), "1.05M")
        self.assertEqual(fmt_tps(0), "--")
        self.assertEqual(fmt_tps(8.734), "8.73")
        self.assertEqual(fmt_tps(52.34), "52.3")


if __name__ == "__main__":
    unittest.main()
