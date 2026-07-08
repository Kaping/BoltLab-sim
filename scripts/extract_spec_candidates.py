from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

from rapidocr_onnxruntime import RapidOCR


ROOT = Path(__file__).resolve().parents[1]
PARTS_JSON = ROOT / "parts.json"
OUTPUT_JSON = ROOT / "spec_candidates.json"
REPORT_MD = ROOT / "spec_extraction_report.md"

DIMENSION_RE = re.compile(r"(?P<prefix>[ØøΦφO0]?)\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>mm)", re.I)
TEETH_NAME_RE = re.compile(r"(?P<teeth>\d{1,3})\s*T\b", re.I)
TEETH_TEXT_RE = re.compile(r"(?P<teeth>\d{1,3})\s*T\b|[:：]\s*(?P<ocr>\d{1,3})\s*[Hh月川个個7]?", re.I)


@dataclass
class OcrDimension:
    raw_text: str
    value_mm: float
    unit: str
    symbol: str | None
    score: float
    bbox: list[list[float]]

    @property
    def center(self) -> tuple[float, float]:
        xs = [point[0] for point in self.bbox]
        ys = [point[1] for point in self.bbox]
        return mean(xs), mean(ys)


def clean_ocr_text(text: str) -> str:
    return text.replace("ｍ", "m").replace("Ｍ", "M").replace("㎜", "mm").strip()


def normalize_dimension(match: re.Match[str], raw_text: str, score: float, bbox: list[list[float]]) -> OcrDimension:
    prefix = match.group("prefix")
    value_text = match.group("value")
    symbol = None

    if prefix in {"Ø", "ø", "Φ", "φ", "O"}:
        symbol = "diameter"
    elif prefix == "0" and "." not in value_text:
        # OCR often reads "Ø4mm" as "04mm".
        symbol = "diameter"

    value = float(value_text)
    if symbol == "diameter" and prefix == "0" and value >= 10:
        value = float(value_text[1:]) if len(value_text) > 1 else value

    return OcrDimension(
        raw_text=raw_text,
        value_mm=value,
        unit="mm",
        symbol=symbol,
        score=score,
        bbox=bbox,
    )


def extract_dimensions(ocr_items: list[Any], min_score: float = 0.72) -> list[OcrDimension]:
    dimensions: list[OcrDimension] = []
    seen: set[tuple[str, float, int, int]] = set()

    for box, text, score in ocr_items:
        if score < min_score:
            continue
        clean_text = clean_ocr_text(text)
        for match in DIMENSION_RE.finditer(clean_text):
            dimension = normalize_dimension(match, clean_text, score, box)
            cx, cy = dimension.center
            key = (dimension.raw_text, dimension.value_mm, round(cx), round(cy))
            if key not in seen:
                seen.add(key)
                dimensions.append(dimension)

    return dimensions


def serialize_ocr_texts(ocr_items: list[Any], min_score: float = 0.55) -> list[dict[str, Any]]:
    texts: list[dict[str, Any]] = []
    for box, text, score in ocr_items:
        if score < min_score:
            continue
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        texts.append(
            {
                "text": clean_ocr_text(text),
                "score": round(score, 4),
                "center": [round(mean(xs), 1), round(mean(ys), 1)],
                "bbox": [[round(x, 1), round(y, 1)] for x, y in box],
            }
        )
    return texts


def normalize_teeth_candidate(value: int) -> int:
    # RapidOCR often reads "19개" as "197", "95개" as "957", etc.
    if 100 <= value <= 999 and value % 10 == 7:
        return value // 10
    return value


def extract_teeth(part: dict[str, Any], ocr_items: list[Any], min_score: float = 0.68) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()

    name_match = TEETH_NAME_RE.search(part["name"])
    if name_match:
        teeth = int(name_match.group("teeth"))
        candidates.append({"teeth": teeth, "source": "name", "text": name_match.group(0), "score": 1.0})
        seen.add((teeth, "name"))

    for box, text, score in ocr_items:
        if score < min_score:
            continue
        clean_text = clean_ocr_text(text)
        if "mm" in clean_text.lower():
            continue
        for match in TEETH_TEXT_RE.finditer(clean_text):
            raw = match.group("teeth") or match.group("ocr")
            if not raw:
                continue
            teeth = normalize_teeth_candidate(int(raw))
            if not 4 <= teeth <= 200:
                continue
            source = "ocr"
            key = (teeth, source)
            if key in seen:
                continue
            seen.add(key)
            xs = [point[0] for point in box]
            ys = [point[1] for point in box]
            candidates.append(
                {
                    "teeth": teeth,
                    "source": source,
                    "text": clean_text,
                    "score": round(score, 4),
                    "center": [round(mean(xs), 1), round(mean(ys), 1)],
                }
            )

    return candidates


def part_holes(part: dict[str, Any]) -> int | None:
    hints = part.get("hints") or {}
    if isinstance(hints.get("holes"), int):
        return hints["holes"]

    match = re.search(r"-(\d+)", part["name"])
    return int(match.group(1)) if match else None


def generic_grid(part: dict[str, Any]) -> str | None:
    hints = part.get("hints") or {}
    if hints.get("grid"):
        return hints["grid"]

    match = re.search(r"(\d+)\s*[xX×]\s*(\d+)", part["name"])
    return f"{match.group(1)}x{match.group(2)}" if match else None


def dimension_values(dimensions: list[OcrDimension]) -> list[float]:
    return sorted({round(d.value_mm, 2) for d in dimensions})


def infer_spec(
    part: dict[str, Any],
    dimensions: list[OcrDimension],
    teeth_candidates: list[dict[str, Any]],
) -> tuple[dict[str, Any], bool, float, list[str]]:
    category = part["category"]
    name = part["name"]
    values = dimension_values(dimensions)
    spec: dict[str, Any] = {}
    notes: list[str] = []
    needs_review = True
    confidence = 0.35

    if not values and not teeth_candidates:
        return spec, True, 0.1, ["no mm dimension text detected"]

    diameter_values = sorted({round(d.value_mm, 2) for d in dimensions if d.symbol == "diameter"})
    non_diameter = sorted({round(d.value_mm, 2) for d in dimensions if d.symbol != "diameter"})
    largest = max(values) if values else None
    smallest = min(values) if values else None

    if category == "strip":
        holes = part_holes(part)
        spec.update({"type": "strip", "length_mm": largest})
        if holes:
            spec["holes"] = holes
        width_candidates = [value for value in values if value != largest and value <= 25]
        if width_candidates:
            spec["width_mm"] = min(width_candidates)
        elif len(values) > 1:
            spec["width_mm"] = smallest
        if holes and holes > 1:
            spec["hole_pitch_mm"] = 12.7
            notes.append("hole_pitch_mm is inferred from the Sciencebox standard pitch, not OCR text")
        needs_review = not ("width_mm" in spec and holes)
        confidence = 0.88 if not needs_review else 0.68

    elif category == "angle":
        holes = part_holes(part)
        spec.update({"type": "angle", "length_mm": largest})
        if holes:
            spec["holes"] = holes
        legs = [value for value in values if value != largest]
        if legs:
            spec["leg_dimensions_mm"] = legs
        needs_review = True
        confidence = 0.78 if len(legs) >= 1 else 0.58

    elif category == "axle":
        spec.update({"type": "axle", "length_mm": largest})
        if diameter_values:
            spec["diameter_mm"] = min(diameter_values)
        else:
            small = [value for value in values if value <= 10]
            if small:
                spec["diameter_mm"] = min(small)
        needs_review = "diameter_mm" not in spec
        confidence = 0.9 if not needs_review else 0.7

    elif category == "bracket":
        spec["type"] = "bracket"
        grid = generic_grid(part)
        if grid:
            spec["grid"] = grid
        if "ㄱ형" in name:
            spec["type"] = "l_bracket"
        elif "ㄷ형" in name:
            spec["type"] = "u_bracket"
        spec["dimensions_mm"] = values
        needs_review = True
        confidence = 0.72 if len(values) >= 2 else 0.48

    elif category in {"plate", "plate_connector"}:
        spec["type"] = "plate"
        grid = generic_grid(part)
        if grid:
            spec["grid"] = grid
        if len(values) >= 2:
            spec["width_mm"] = smallest
            spec["length_mm"] = largest
        else:
            spec["dimensions_mm"] = values
        needs_review = True
        confidence = 0.7 if len(values) >= 2 else 0.45

    elif category in {"gear", "wheel_pulley"}:
        spec["type"] = category
        if diameter_values:
            spec["diameter_mm"] = max(diameter_values)
        if values:
            spec["dimensions_mm"] = values
        if teeth_candidates:
            best_teeth = sorted(teeth_candidates, key=lambda item: (item["source"] != "name", -item["score"]))[0]
            spec["teeth"] = best_teeth["teeth"]
            spec["teeth_source"] = best_teeth["source"]
        needs_review = True
        confidence = 0.65 if values else 0.3
        if "teeth" in spec:
            confidence = max(confidence, 0.75)

    elif category == "fastener":
        spec["type"] = "fastener"
        if diameter_values:
            spec["diameter_mm"] = min(diameter_values)
        spec["dimensions_mm"] = values
        needs_review = True
        confidence = 0.6

    else:
        spec["type"] = category
        spec["dimensions_mm"] = values
        needs_review = True
        confidence = 0.55

    if non_diameter and diameter_values:
        spec["observed_non_diameter_mm"] = non_diameter
        spec["observed_diameter_mm"] = diameter_values

    return spec, needs_review, confidence, notes


def serialize_dimension(dimension: OcrDimension) -> dict[str, Any]:
    cx, cy = dimension.center
    return {
        "text": dimension.raw_text,
        "value_mm": dimension.value_mm,
        "kind": dimension.symbol or "linear",
        "score": round(dimension.score, 4),
        "center": [round(cx, 1), round(cy, 1)],
        "bbox": [[round(x, 1), round(y, 1)] for x, y in dimension.bbox],
    }


def main() -> None:
    payload = json.loads(PARTS_JSON.read_text(encoding="utf-8"))
    parts = payload["parts"]
    ocr = RapidOCR()

    candidates: list[dict[str, Any]] = []
    failures: list[str] = []

    for index, part in enumerate(parts, start=1):
        image_path = ROOT / part["images"]["detail"]
        print(f"[{index:03}/{len(parts)}] OCR {part['part_no']} {part['name']}", flush=True)

        try:
            ocr_items, elapsed = ocr(str(image_path))
            ocr_items = ocr_items or []
        except Exception as exc:  # noqa: BLE001
            ocr_items = []
            elapsed = []
            failures.append(f"{part['part_no']} {part['name']}: {exc}")

        dimensions = extract_dimensions(ocr_items)
        teeth_candidates = (
            extract_teeth(part, ocr_items)
            if part["category"] in {"gear", "wheel_pulley"} or TEETH_NAME_RE.search(part["name"])
            else []
        )
        spec, needs_review, confidence, notes = infer_spec(part, dimensions, teeth_candidates)

        candidate = {
            "it_id": part["it_id"],
            "part_no": part["part_no"],
            "name": part["name"],
            "category": part["category"],
            "source_image": part["images"]["detail"],
            "url": part["url"],
            "ocr_texts": serialize_ocr_texts(ocr_items),
            "ocr_dimensions": [serialize_dimension(dimension) for dimension in dimensions],
            "teeth_candidates": teeth_candidates,
            "candidate_spec": spec,
            "confidence": round(confidence, 2),
            "needs_review": needs_review,
        }
        if notes:
            candidate["notes"] = notes
        if elapsed:
            candidate["ocr_elapsed"] = elapsed

        candidates.append(candidate)

    output = {
        "meta": {
            "source": "sciencebox.co.kr detail images",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(candidates),
            "ocr_engine": "rapidocr-onnxruntime",
            "dimension_filter": "score >= 0.72, mm tokens only",
        },
        "candidates": candidates,
    }
    OUTPUT_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    no_dimensions = [c for c in candidates if not c["ocr_dimensions"]]
    review = [c for c in candidates if c["needs_review"]]
    report_lines = [
        "# Spec Extraction Report",
        "",
        f"- Generated at: {output['meta']['generated_at']}",
        "- OCR engine: rapidocr-onnxruntime",
        f"- Parts processed: {len(candidates)}",
        f"- OCR failures: {len(failures)}",
        f"- No dimension text detected: {len(no_dimensions)}",
        f"- Needs review: {len(review)}",
        "",
        "## OCR Failures",
        "",
        *([f"- {failure}" for failure in failures] if failures else ["- none"]),
        "",
        "## No Dimension Text",
        "",
        *([f"- {c['part_no']} {c['name']}" for c in no_dimensions] if no_dimensions else ["- none"]),
        "",
        "## Needs Review",
        "",
        *[f"- {c['part_no']} {c['name']} ({len(c['ocr_dimensions'])} dimension texts)" for c in review],
        "",
    ]
    REPORT_MD.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Wrote {OUTPUT_JSON}")
    print(f"Wrote {REPORT_MD}")


if __name__ == "__main__":
    main()
