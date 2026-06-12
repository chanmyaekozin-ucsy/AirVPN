"""Decode QR payload from KBZPay e-receipt screenshot."""
from __future__ import annotations

import cv2
import numpy as np


def _try_decode(detector: cv2.QRCodeDetector, image) -> str | None:
    data, _, _ = detector.detectAndDecode(image)
    return data if data else None


def decode_qr_from_image(image_bytes: bytes) -> str | None:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        return None

    detector = cv2.QRCodeDetector()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe_gray = cv2.createCLAHE(2.0, (8, 8)).apply(gray)

    candidates: list = [bgr, gray, clahe_gray]
    for g in (gray, clahe_gray):
        h, w = g.shape[:2]
        for scale in (0.5, 0.75, 1.5, 2.0, 3.0, 4.0):
            nh, nw = int(h * scale), int(w * scale)
            if nh < 80 or nw < 80:
                continue
            candidates.append(
                cv2.resize(g, (nw, nh), interpolation=cv2.INTER_CUBIC),
            )

    for img in candidates:
        text = _try_decode(detector, img)
        if text:
            return text.strip()
    return None
