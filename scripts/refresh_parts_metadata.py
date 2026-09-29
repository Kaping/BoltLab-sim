from __future__ import annotations

import json
from pathlib import Path

from crawl_parts import category_for_name, hints_for_name


ROOT = Path(__file__).resolve().parents[1]
PARTS_JSON = ROOT / "parts.json"
REPORT_MD = ROOT / "crawl_report.md"


def main() -> None:
    data = json.loads(PARTS_JSON.read_text(encoding="utf-8"))
    misc_lines: list[str] = []

    for part in data["parts"]:
        category, _mapped = category_for_name(part["name"])
        part["category"] = category

        hints = hints_for_name(part["name"])
        if hints:
            part["hints"] = hints
        else:
            part.pop("hints", None)

        if category == "misc":
            misc_lines.append(f"- {part['part_no']} {part['name']}")

    PARTS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report = REPORT_MD.read_text(encoding="utf-8")
    start = report.index("## Misc / Unmapped Parts")
    end = report.index("## Extra Editor Images")
    replacement = "## Misc / Unmapped Parts\n\n" + ("\n".join(misc_lines) if misc_lines else "- none") + "\n\n"
    REPORT_MD.write_text(report[:start] + replacement + report[end:], encoding="utf-8")

    print(f"Updated categories; misc count={len(misc_lines)}")


if __name__ == "__main__":
    main()
