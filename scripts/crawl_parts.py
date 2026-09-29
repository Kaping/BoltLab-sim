from __future__ import annotations

import io
import json
import os
import random
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from PIL import Image


# 크롤링 대상 쇼핑몰 주소는 환경변수로 지정 (예: PARTS_BASE_URL=https://example.com)
BASE_URL = os.environ.get("PARTS_BASE_URL", "").rstrip("/")
LIST_URL = f"{BASE_URL}/shop/list.php?ca_id=50&page={{page}}"
ITEM_URL = f"{BASE_URL}/shop/item.php?it_id={{it_id}}&cat=50"
USER_AGENT = "BoltLabSimDataBot/1.0 (+local simulator data build; polite crawl)"
EXPECTED_COUNT = 190
MIN_DELAY_SECONDS = 0.55
MAX_DELAY_SECONDS = 0.95

ROOT = Path(__file__).resolve().parents[1]
IMAGES_DIR = ROOT / "images"
PARTS_JSON = ROOT / "parts.json"
REPORT_MD = ROOT / "crawl_report.md"


@dataclass
class CrawlReport:
    robots_status: str = ""
    list_pages: list[str] = field(default_factory=list)
    parse_failures: list[str] = field(default_factory=list)
    duplicate_it_ids: list[str] = field(default_factory=list)
    duplicate_part_nos: list[str] = field(default_factory=list)
    missing_main_images: list[str] = field(default_factory=list)
    missing_detail_images: list[str] = field(default_factory=list)
    image_failures: list[str] = field(default_factory=list)
    multiple_editor_images: dict[str, list[str]] = field(default_factory=dict)
    misc_parts: list[str] = field(default_factory=list)
    unmapped_names: list[str] = field(default_factory=list)


class PoliteClient:
    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self._last_request_at = 0.0

    def get(self, url: str) -> requests.Response:
        elapsed = time.monotonic() - self._last_request_at
        wait = random.uniform(MIN_DELAY_SECONDS, MAX_DELAY_SECONDS)
        if elapsed < wait:
            time.sleep(wait - elapsed)

        response = self.session.get(url, timeout=30)
        self._last_request_at = time.monotonic()
        response.raise_for_status()
        return response


def decode_html(response: requests.Response) -> str:
    response.encoding = "utf-8"
    return response.text


def absolute_url(url: str) -> str:
    return urljoin(BASE_URL, url)


def item_id_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    values = parse_qs(parsed.query).get("it_id")
    return values[0] if values else None


def closest(tag: Any, name: str) -> Any | None:
    node = tag
    while node is not None:
        if getattr(node, "name", None) == name:
            return node
        node = node.parent
    return None


def parse_list_page(html: str, page: int, report: CrawlReport) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []

    for img in soup.find_all("img", src=True):
        thumb_url = absolute_url(img["src"])
        if "/data/item/" not in thumb_url:
            continue

        li = closest(img, "li")
        if li is None:
            report.parse_failures.append(f"page {page}: no enclosing li for {thumb_url}")
            continue

        detail_link = None
        for link in li.find_all("a", href=True):
            if "item.php" in link["href"]:
                detail_link = absolute_url(link["href"])
                break

        if not detail_link:
            report.parse_failures.append(f"page {page}: missing detail link for {thumb_url}")
            continue

        it_id = item_id_from_url(detail_link)
        text = li.get_text(" ", strip=True)
        match = re.search(
            r"(?P<part_no>\d+(?:-\d+)?[A-Z]?)\.\s*(?P<name>.+?)\s+(?P<price>[\d,]+)\s*원",
            text,
        )

        if not it_id or not match:
            report.parse_failures.append(f"page {page}: failed parse: {text}")
            continue

        rows.append(
            {
                "it_id": it_id,
                "part_no": match.group("part_no"),
                "name": match.group("name").strip(),
                "price": int(match.group("price").replace(",", "")),
                "thumb_url": thumb_url,
                "url": f"{BASE_URL}/shop/item.php?it_id={it_id}&cat=50",
            }
        )

    report.list_pages.append(f"page {page}: {len(rows)} items")
    return rows


def choose_main_image(soup: BeautifulSoup, it_id: str, fallback_url: str) -> str:
    patterns = [
        re.compile(rf"/data/item/{re.escape(it_id)}/thumb-.+_700x700\.", re.I),
        re.compile(rf"/data/item/{re.escape(it_id)}/thumb-.+_400x400\.", re.I),
        re.compile(rf"/data/item/{re.escape(it_id)}/[^/?#]+\.(?:jpe?g|png|gif)$", re.I),
    ]

    candidates: list[str] = []
    for tag in soup.find_all(["a", "img"], href=True):
        candidates.append(absolute_url(tag["href"]))
    for tag in soup.find_all("img", src=True):
        candidates.append(absolute_url(tag["src"]))

    for pattern in patterns:
        for url in candidates:
            if pattern.search(url):
                return url

    return fallback_url


def editor_image_urls(soup: BeautifulSoup) -> list[str]:
    urls: list[str] = []
    for img in soup.find_all("img", src=True):
        src = absolute_url(img["src"])
        if "/data/editor/" in src and src not in urls:
            urls.append(src)
    return urls


def detail_info(html: str, part: dict[str, Any], report: CrawlReport) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text("\n", strip=True)
    main_url = choose_main_image(soup, part["it_id"], part["thumb_url"])
    detail_urls = editor_image_urls(soup)

    if not main_url:
        report.missing_main_images.append(part["part_no"])
    if not detail_urls:
        report.missing_detail_images.append(part["part_no"])
    elif len(detail_urls) > 1:
        report.multiple_editor_images[part["part_no"]] = detail_urls[1:]

    return {
        "main_image_url": main_url,
        "detail_image_url": detail_urls[0] if detail_urls else None,
        "in_stock": "재고가 부족하여 구매할 수 없습니다" not in text,
    }


def category_for_name(name: str) -> tuple[str, bool]:
    rules = [
        ("strip", ["스트립"]),
        ("angle", ["앵글"]),
        ("bracket", ["브래킷"]),
        ("plate_connector", ["이음판"]),
        ("gear", ["기어", "피니언", "래크", "웜", "워엄"]),
        ("axle", ["축", "샤프트", "나사봉"]),
        ("wheel_pulley", ["휠", "바퀴", "타이어", "풀리"]),
        ("fastener", ["볼트", "너트", "와셔", "나사", "클립"]),
        ("electric", ["모터", "전지", "스위치", "코드", "전선"]),
        ("plate", ["판", "플레이트"]),
    ]

    for category, keywords in rules:
        if any(keyword in name for keyword in keywords):
            return category, True
    return "misc", False


def hints_for_name(name: str) -> dict[str, Any]:
    hints: dict[str, Any] = {}

    grid = re.search(r"(\d+)\s*[xX×]\s*(\d+)", name)
    if grid:
        hints["grid"] = f"{grid.group(1)}x{grid.group(2)}"

    if "스트립" in name or "앵글" in name:
        holes = re.search(r"-(\d+)", name)
        if holes:
            hints["holes"] = int(holes.group(1))

    length = re.search(r"(\d+(?:\.\d+)?)\s*cm", name, re.I)
    if length:
        value = float(length.group(1))
        hints["length_cm"] = int(value) if value.is_integer() else value

    teeth = re.search(r"(\d+)\s*T", name, re.I)
    if teeth:
        hints["teeth"] = int(teeth.group(1))

    size = re.search(r"\((소|중|대)\)", name)
    if size:
        hints["size"] = size.group(1)

    for color in ["빨강", "파랑", "투명", "오렌지색", "파랑색"]:
        if color in name:
            hints["color"] = color
            break

    return hints


def save_as_jpeg(client: PoliteClient, url: str | None, path: Path, report: CrawlReport, part_no: str) -> bool:
    if not url:
        return False

    try:
        response = client.get(url)
        image = Image.open(io.BytesIO(response.content))
        if image.mode in {"RGBA", "LA", "P"}:
            background = Image.new("RGB", image.size, "white")
            if image.mode == "P":
                image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1] if image.mode in {"RGBA", "LA"} else None)
            image = background
        else:
            image = image.convert("RGB")
        image.save(path, "JPEG", quality=92, optimize=True)
        return path.exists() and path.stat().st_size > 0
    except Exception as exc:  # noqa: BLE001
        report.image_failures.append(f"{part_no}: {url}: {exc}")
        return False


def check_robots(client: PoliteClient, report: CrawlReport) -> RobotFileParser | None:
    robots_url = f"{BASE_URL}/robots.txt"
    parser = RobotFileParser()
    parser.set_url(robots_url)

    try:
        response = client.get(robots_url)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            report.robots_status = "robots.txt: 404 Not Found; no crawl rules published."
            return None
        raise

    parser.parse(response.text.splitlines())
    allowed = parser.can_fetch(USER_AGENT, LIST_URL.format(page=1))
    report.robots_status = f"robots.txt: HTTP {response.status_code}; list page allowed={allowed}."
    if not allowed:
        raise RuntimeError(f"robots.txt disallows {LIST_URL.format(page=1)} for {USER_AGENT}")
    return parser


def validate(parts: list[dict[str, Any]], report: CrawlReport) -> None:
    it_ids = [part["it_id"] for part in parts]
    part_nos = [part["part_no"] for part in parts]

    report.duplicate_it_ids = sorted({value for value in it_ids if it_ids.count(value) > 1})
    report.duplicate_part_nos = sorted({value for value in part_nos if part_nos.count(value) > 1})

    for part in parts:
        main = ROOT / part["images"]["main"]
        detail = ROOT / part["images"]["detail"]
        if not main.exists() or main.stat().st_size == 0:
            report.missing_main_images.append(part["part_no"])
        if not detail.exists() or detail.stat().st_size == 0:
            report.missing_detail_images.append(part["part_no"])


def write_parts_json(parts: list[dict[str, Any]]) -> None:
    payload = {
        "meta": {
            "crawled_at": datetime.now(timezone.utc).isoformat(),
            "count": len(parts),
        },
        "parts": parts,
    }
    PARTS_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_report(parts: list[dict[str, Any]], report: CrawlReport) -> None:
    lines = [
        "# Parts Crawl Report",
        "",
        f"- Crawled at: {datetime.now(timezone.utc).isoformat()}",
        f"- Robots: {report.robots_status}",
        f"- Expected count: {EXPECTED_COUNT}",
        f"- Actual count: {len(parts)}",
        f"- Unique it_id count: {len({part['it_id'] for part in parts})}",
        f"- Unique part_no count: {len({part['part_no'] for part in parts})}",
        "",
        "## List Pages",
        "",
        *[f"- {entry}" for entry in report.list_pages],
        "",
        "## Validation",
        "",
        f"- Count OK: {len(parts) == EXPECTED_COUNT}",
        f"- Duplicate it_id: {', '.join(report.duplicate_it_ids) if report.duplicate_it_ids else 'none'}",
        f"- Duplicate part_no: {', '.join(report.duplicate_part_nos) if report.duplicate_part_nos else 'none'}",
        f"- Parse failures: {len(report.parse_failures)}",
        f"- Missing main images: {len(set(report.missing_main_images))}",
        f"- Missing detail images: {len(set(report.missing_detail_images))}",
        f"- Image failures: {len(report.image_failures)}",
        "",
        "## Parse Failures",
        "",
        *([f"- {entry}" for entry in report.parse_failures] if report.parse_failures else ["- none"]),
        "",
        "## Missing Images",
        "",
        f"- Main: {', '.join(sorted(set(report.missing_main_images))) if report.missing_main_images else 'none'}",
        f"- Detail: {', '.join(sorted(set(report.missing_detail_images))) if report.missing_detail_images else 'none'}",
        "",
        "## Image Failures",
        "",
        *([f"- {entry}" for entry in report.image_failures] if report.image_failures else ["- none"]),
        "",
        "## Misc / Unmapped Parts",
        "",
        *([f"- {entry}" for entry in report.misc_parts] if report.misc_parts else ["- none"]),
        "",
        "## Extra Editor Images",
        "",
    ]

    if report.multiple_editor_images:
        for part_no, urls in sorted(report.multiple_editor_images.items()):
            lines.append(f"- {part_no}: {len(urls)} extra image(s)")
            for url in urls:
                lines.append(f"  - {url}")
    else:
        lines.append("- none")

    lines.append("")
    REPORT_MD.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    IMAGES_DIR.mkdir(exist_ok=True)
    report = CrawlReport()
    client = PoliteClient()

    if not BASE_URL:
        raise SystemExit("PARTS_BASE_URL 환경변수를 설정하세요.")
    check_robots(client, report)

    listed_parts: list[dict[str, Any]] = []
    for page in range(1, 11):
        print(f"Fetching list page {page}/10")
        response = client.get(LIST_URL.format(page=page))
        listed_parts.extend(parse_list_page(decode_html(response), page, report))

    seen_it_ids: set[str] = set()
    parts: list[dict[str, Any]] = []
    for index, part in enumerate(listed_parts, start=1):
        if part["it_id"] in seen_it_ids:
            continue
        seen_it_ids.add(part["it_id"])

        print(f"Fetching detail {index}/{len(listed_parts)}: {part['part_no']} {part['name']}")
        response = client.get(part["url"])
        info = detail_info(decode_html(response), part, report)

        main_rel = f"images/{part['part_no']}_main.jpg"
        detail_rel = f"images/{part['part_no']}_detail.jpg"
        save_as_jpeg(client, info["main_image_url"], ROOT / main_rel, report, part["part_no"])
        save_as_jpeg(client, info["detail_image_url"], ROOT / detail_rel, report, part["part_no"])

        category, mapped = category_for_name(part["name"])
        if category == "misc":
            report.misc_parts.append(f"{part['part_no']} {part['name']}")
        if not mapped:
            report.unmapped_names.append(part["name"])

        output_part = {
            "it_id": part["it_id"],
            "part_no": part["part_no"],
            "name": part["name"],
            "category": category,
            "price": part["price"],
            "in_stock": info["in_stock"],
            "images": {"main": main_rel, "detail": detail_rel},
            "geometry": None,
        }
        hints = hints_for_name(part["name"])
        if hints:
            output_part["hints"] = hints

        parts.append(output_part)

    validate(parts, report)
    write_parts_json(parts)
    write_report(parts, report)

    if len(parts) != EXPECTED_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_COUNT} parts but crawled {len(parts)}")
    if report.duplicate_it_ids:
        raise RuntimeError(f"Duplicate it_id values: {report.duplicate_it_ids}")
    if report.parse_failures or report.image_failures:
        raise RuntimeError("Crawl completed with parse or image failures. See crawl_report.md.")

    print(f"Wrote {PARTS_JSON}")
    print(f"Wrote {REPORT_MD}")
    print(f"Wrote images to {IMAGES_DIR}")


if __name__ == "__main__":
    main()
