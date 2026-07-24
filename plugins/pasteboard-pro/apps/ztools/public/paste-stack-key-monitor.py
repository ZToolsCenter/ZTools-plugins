#!/usr/bin/env python3
"""Intercept Command-V while PasteboardPro has a queued paste item.

The parent process decides whether each event should pass through or be replaced.
This helper is intentionally source-only so the plugin does not ship another native binary.
"""

import sys
import threading
from typing import Dict

import Quartz


VIRTUAL_KEY_V = 9
RESPONSE_TIMEOUT_SECONDS = 0.2

condition = threading.Condition()
responses: Dict[int, str] = {}
allow_next = False
v_pressed = False
request_id = 0


def stdin_loop() -> None:
    global allow_next
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if line == "allow-next":
            with condition:
                allow_next = True
            continue
        action, separator, raw_id = line.partition(":")
        if separator == "" or action not in ("consume", "pass"):
            continue
        try:
            parsed_id = int(raw_id)
        except ValueError:
            continue
        with condition:
            responses[parsed_id] = action
            condition.notify_all()


def event_callback(_proxy, event_type, event, _refcon):
    global allow_next, request_id, v_pressed
    keycode = Quartz.CGEventGetIntegerValueField(
        event, Quartz.kCGKeyboardEventKeycode
    )
    if keycode != VIRTUAL_KEY_V:
        return event
    if event_type == Quartz.kCGEventKeyUp:
        v_pressed = False
        return event

    flags = Quartz.CGEventGetFlags(event)
    command = bool(flags & Quartz.kCGEventFlagMaskCommand)
    forbidden = bool(
        flags
        & (
            Quartz.kCGEventFlagMaskShift
            | Quartz.kCGEventFlagMaskAlternate
            | Quartz.kCGEventFlagMaskControl
        )
    )
    if not command or forbidden:
        return event

    with condition:
        if allow_next:
            allow_next = False
            return event
        if v_pressed:
            return None
        v_pressed = True
        request_id += 1
        current_id = request_id

    print(f"paste:{current_id}", flush=True)
    with condition:
        condition.wait_for(
            lambda: current_id in responses,
            timeout=RESPONSE_TIMEOUT_SECONDS,
        )
        action = responses.pop(current_id, "pass")
    return None if action == "consume" else event


def main() -> int:
    thread = threading.Thread(target=stdin_loop, daemon=True)
    thread.start()
    event_mask = Quartz.CGEventMaskBit(Quartz.kCGEventKeyDown) | Quartz.CGEventMaskBit(
        Quartz.kCGEventKeyUp
    )
    tap = Quartz.CGEventTapCreate(
        Quartz.kCGSessionEventTap,
        Quartz.kCGHeadInsertEventTap,
        Quartz.kCGEventTapOptionDefault,
        event_mask,
        event_callback,
        None,
    )
    if tap is None:
        print("accessibility-required", flush=True)
        return 2
    source = Quartz.CFMachPortCreateRunLoopSource(None, tap, 0)
    Quartz.CFRunLoopAddSource(
        Quartz.CFRunLoopGetCurrent(), source, Quartz.kCFRunLoopCommonModes
    )
    Quartz.CGEventTapEnable(tap, True)
    print("ready", flush=True)
    Quartz.CFRunLoopRun()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
