#!/usr/bin/env python3
"""Validate the versioned line-color configuration before publishing it."""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
CLASSES = {
    "high_speed", "conventional_main", "conventional_other", "branch",
    "industrial", "metro", "light_rail", "tram", "other", "unknown",
}
LIFECYCLES = {
    "mapped", "construction", "proposed", "disused", "abandoned",
    "razed", "unknown", "conflict",
}
CONFIDENCE = {"official", "operator-map", "manual", "osm", "fallback"}
STATUS = {"operating", "construction", "planned", "unknown"}
PRIORITY = {"override", "operator_ref", "osm_colour", "class_fallback"}


def channel(value):
    value /= 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def luminance(color):
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    high, low = max(la, lb), min(la, lb)
    return (high + 0.05) / (low + 0.05)


def readable_text(color):
    black, white = contrast(color, "#000000"), contrast(color, "#FFFFFF")
    return "#000000" if black >= white else "#FFFFFF"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/line-colors.json")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = parser.parse_args()

    errors, warnings, notices = [], [], []
    try:
        data = json.loads(args.config.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: cannot read {args.config}: {exc}", file=sys.stderr)
        return 1

    def need(condition, message):
        if not condition:
            errors.append(message)

    def color(value, label):
        need(isinstance(value, str) and bool(HEX.match(value)), f"{label}: invalid color {value!r}")
        return value if isinstance(value, str) and HEX.match(value) else None

    for key in ("schema_version", "palette_version", "updated_at", "background",
                "class_palette", "lifecycle_styles", "selection", "operators",
                "overrides", "fallbacks", "line_color_policy"):
        need(key in data, f"missing top-level key: {key}")
    if errors:
        for message in errors:
            print(f"ERROR: {message}", file=sys.stderr)
        return 1

    need(data["schema_version"] == 1, "schema_version must be 1")
    need(bool(re.match(r"^\d{4}-\d{2}-\d{2}(\.\d+)?$", str(data["palette_version"]))),
         "palette_version must look like YYYY-MM-DD or YYYY-MM-DD.N")
    need(bool(re.match(r"^\d{4}-\d{2}-\d{2}$", str(data["updated_at"]))),
         "updated_at must be YYYY-MM-DD")
    background = color(data["background"], "background")

    policy = data["line_color_policy"]
    priority = policy.get("priority", []) if isinstance(policy, dict) else []
    need(isinstance(priority, list) and sorted(priority) == sorted(PRIORITY),
         f"line_color_policy.priority must contain {sorted(PRIORITY)}")
    need(policy.get("shared_segment") == "fallback_mode_color",
         "shared_segment policy must be fallback_mode_color")
    need(policy.get("unknown_line") == "fallback_mode_color",
         "unknown_line policy must be fallback_mode_color")

    classes = data["class_palette"]
    need(isinstance(classes, dict) and set(classes) == CLASSES,
         f"class_palette must contain exactly {sorted(CLASSES)}")
    for key, entry in classes.items():
        if not isinstance(entry, dict):
            errors.append(f"class_palette.{key}: must be an object")
            continue
        color(entry.get("color"), f"class_palette.{key}.color")
        color(entry.get("casing"), f"class_palette.{key}.casing")
        need(isinstance(entry.get("label"), str) and entry["label"], f"class_palette.{key}.label missing")
        need(isinstance(entry.get("width"), (int, float)) and entry["width"] > 0,
             f"class_palette.{key}.width must be positive")

    lifecycle = data["lifecycle_styles"]
    need(isinstance(lifecycle, dict) and set(lifecycle) == LIFECYCLES,
         f"lifecycle_styles must contain exactly {sorted(LIFECYCLES)}")
    for key, entry in lifecycle.items():
        if not isinstance(entry, dict):
            errors.append(f"lifecycle_styles.{key}: must be an object")
            continue
        if "color" in entry:
            color(entry["color"], f"lifecycle_styles.{key}.color")
        dash = entry.get("dasharray")
        need(isinstance(dash, list) and all(isinstance(v, (int, float)) and v > 0 for v in dash),
             f"lifecycle_styles.{key}.dasharray must be a list of positive numbers")
        opacity = entry.get("opacity")
        need(isinstance(opacity, (int, float)) and 0 <= opacity <= 1,
             f"lifecycle_styles.{key}.opacity must be within 0..1")

    selection = data["selection"]
    color(selection.get("color"), "selection.color")
    color(selection.get("halo"), "selection.halo")
    need(isinstance(selection.get("width_add"), (int, float)) and selection["width_add"] > 0,
         "selection.width_add must be positive")

    operators = data["operators"]
    need(isinstance(operators, dict) and bool(operators), "operators must be a non-empty object")
    for operator_key, operator in operators.items():
        if not isinstance(operator, dict):
            errors.append(f"operators.{operator_key}: must be an object")
            continue
        for key in ("name", "source", "source_url", "verified_at", "confidence", "lines"):
            need(key in operator, f"operators.{operator_key}.{key} missing")
        need(bool(re.match(r"^\d{4}-\d{2}-\d{2}$", str(operator.get("verified_at")))),
             f"operators.{operator_key}.verified_at must be YYYY-MM-DD")
        need(operator.get("confidence") in CONFIDENCE,
             f"operators.{operator_key}.confidence must be one of {sorted(CONFIDENCE)}")
        lines = operator.get("lines", {})
        need(isinstance(lines, dict) and bool(lines), f"operators.{operator_key}.lines must be non-empty")
        seen = {}
        for ref, line in lines.items():
            if not isinstance(line, dict):
                errors.append(f"operators.{operator_key}.lines.{ref}: must be an object")
                continue
            line_color = color(line.get("color"), f"operators.{operator_key}.lines.{ref}.color")
            need(isinstance(line.get("name"), str) and line["name"],
                 f"operators.{operator_key}.lines.{ref}.name missing")
            need(line.get("status") in STATUS,
                 f"operators.{operator_key}.lines.{ref}.status must be one of {sorted(STATUS)}")
            if line_color and background:
                ratio = contrast(line_color, background)
                if ratio < 3:
                    notices.append(
                        f"{operator_key}/{ref} {line_color} contrast {ratio:.2f}:1 < 3:1; "
                        f"renderer must use a dark casing; suggested badge text {readable_text(line_color)}"
                    )
                if line_color in seen:
                    warnings.append(
                        f"{operator_key}: lines {seen[line_color]} and {ref} share color {line_color}"
                    )
                seen[line_color] = ref

    overrides = data["overrides"]
    need(isinstance(overrides, list), "overrides must be a list")
    for index, override in enumerate(overrides):
        if not isinstance(override, dict):
            errors.append(f"overrides[{index}]: must be an object")
            continue
        color(override.get("color"), f"overrides[{index}].color")
        need("line_key" in override or "relation_id" in override or "feature_key" in override,
             f"overrides[{index}]: need line_key, relation_id or feature_key")
        need(isinstance(override.get("source"), str) and override["source"],
             f"overrides[{index}].source missing")
        need(bool(re.match(r"^\d{4}-\d{2}-\d{2}$", str(override.get("verified_at")))),
             f"overrides[{index}].verified_at must be YYYY-MM-DD")

    fallbacks = data["fallbacks"]
    need(isinstance(fallbacks, dict), "fallbacks must be an object")
    for key in ("subway", "light_rail", "tram", "other", "unknown"):
        color(fallbacks.get(key), f"fallbacks.{key}")

    for message in notices:
        print(f"NOTICE: {message}", file=sys.stderr)
    for message in warnings:
        print(f"WARN: {message}", file=sys.stderr)
    for message in errors:
        print(f"ERROR: {message}", file=sys.stderr)
    if errors or (args.strict and warnings):
        return 1

    line_count = sum(len(op.get("lines", {})) for op in operators.values() if isinstance(op, dict))
    print(
        f"OK: {args.config} schema={data['schema_version']} "
        f"palette={data['palette_version']} operators={len(operators)} "
        f"lines={line_count} warnings={len(warnings)} notices={len(notices)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
