"""Simple in-memory circuit breaker for upstream dependency calls."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreaker:
    """
    Opens after [failure_threshold] consecutive failures.
    After [recovery_timeout_sec], allows one half-open probe.
    Success closes; failure re-opens.
    """

    failure_threshold: int = 5
    recovery_timeout_sec: float = 90.0
    failures: int = 0
    opened_at: float = 0.0
    state: CircuitState = CircuitState.CLOSED
    half_open_inflight: bool = False

    def allow(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            if time.time() - self.opened_at < self.recovery_timeout_sec:
                return False
            self.state = CircuitState.HALF_OPEN
            self.half_open_inflight = False
        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_inflight:
                return False
            self.half_open_inflight = True
            return True
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.half_open_inflight = False
        self.state = CircuitState.CLOSED
        self.opened_at = 0.0

    def record_failure(self) -> None:
        self.failures += 1
        self.half_open_inflight = False
        if self.state == CircuitState.HALF_OPEN or self.failures >= self.failure_threshold:
            self.state = CircuitState.OPEN
            self.opened_at = time.time()


@dataclass
class CircuitBreakerRegistry:
    failure_threshold: int = 5
    recovery_timeout_sec: float = 90.0
    _items: Dict[str, CircuitBreaker] = field(default_factory=dict)

    def get(self, key: str) -> CircuitBreaker:
        br = self._items.get(key)
        if br is None:
            br = CircuitBreaker(
                failure_threshold=self.failure_threshold,
                recovery_timeout_sec=self.recovery_timeout_sec,
            )
            self._items[key] = br
        return br

    def reset(self, key: str | None = None) -> None:
        if key:
            self._items.pop(key, None)
        else:
            self._items.clear()


class CircuitOpenError(RuntimeError):
    """Raised when the circuit is open and no request should be sent."""
