"""Detect ad image type and pixel size from raw bytes (no Pillow)."""
from __future__ import annotations

import struct
from typing import Any


def sniff_image_ext(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def image_dimensions(data: bytes) -> tuple[int, int]:
    """Return (width, height) or (0, 0) if unknown."""
    if not data:
        return 0, 0
    ext = sniff_image_ext(data)
    try:
        if ext == ".png":
            return _png_size(data)
        if ext == ".jpg":
            return _jpeg_size(data)
        if ext == ".gif":
            return _gif_size(data)
        if ext == ".webp":
            return _webp_size(data)
    except Exception:
        pass
    # Fallback: OpenCV if available
    try:
        import cv2
        import numpy as np

        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if img is not None and img.shape[0] > 0 and img.shape[1] > 0:
            h, w = img.shape[:2]
            return int(w), int(h)
    except Exception:
        pass
    return 0, 0


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24:
        return 0, 0
    w, h = struct.unpack(">II", data[16:24])
    return int(w), int(h)


def _gif_size(data: bytes) -> tuple[int, int]:
    if len(data) < 10:
        return 0, 0
    w, h = struct.unpack("<HH", data[6:10])
    return int(w), int(h)


def _jpeg_size(data: bytes) -> tuple[int, int]:
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0xD9) or marker == 0x01 or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > n:
            break
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if seglen < 2:
            break
        # SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
        if marker in (
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        ):
            if i + 9 > n:
                break
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return int(w), int(h)
        i += 2 + seglen
    return 0, 0


def _webp_size(data: bytes) -> tuple[int, int]:
    if len(data) < 30:
        return 0, 0
    # RIFF....WEBP
    chunk = data[12:16]
    if chunk == b"VP8 " and len(data) >= 30:
        # lossy: width/height in frame header at offset 26
        w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return int(w), int(h)
    if chunk == b"VP8L" and len(data) >= 25:
        bits = struct.unpack("<I", data[21:25])[0]
        w = (bits & 0x3FFF) + 1
        h = ((bits >> 14) & 0x3FFF) + 1
        return int(w), int(h)
    if chunk == b"VP8X" and len(data) >= 30:
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
        return int(w), int(h)
    return 0, 0


def describe_image(data: bytes) -> dict[str, Any]:
    ext = sniff_image_ext(data)
    w, h = image_dimensions(data)
    return {"ext": ext, "width": w, "height": h}
