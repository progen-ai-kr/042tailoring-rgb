#!/usr/bin/env python3
"""PROGEN 정적 사이트의 안전한 병합을 검사합니다."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path.cwd().resolve()
CORE_PAGES = (
    "index.html",
    "about.html",
    "contact.html",
    "products.html",
    "product.html",
    "portfolio.html",
)
PROTECTED_FILES = {
    ".assetsignore",
    "AGENTS.md",
    "STUDENT_GUIDE.md",
    "RULES.md",
    "wrangler.jsonc",
    "wrangler.admin.jsonc",
    "worker.js",
    "products.json",
    "portfolio.json",
    "admin-config.json",
    "brand-config.js",
    "admin.html",
    "admin.css",
    "admin.js",
    "catalog.js",
    "portfolio.js",
}
TEXT_SUFFIXES = {".html", ".css", ".js", ".json", ".md", ".yml", ".yaml"}
MAX_CHANGED_FILE_BYTES = 12 * 1024 * 1024
OPTIONAL_LOCAL_FILES = {"favicon.ico", "images/favicon.png"}


def git_lines(*args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line for line in result.stdout.splitlines() if line]


def changed_files(base: str, head: str) -> list[str]:
    return git_lines("diff", "--name-only", "--diff-filter=ACMR", base, head)


def is_protected(path: str) -> bool:
    return path in PROTECTED_FILES or path.startswith(".github/")


def local_reference_target(reference: str, source: Path) -> Path | None:
    value = reference.strip()
    if not value or value.startswith(("#", "//")):
        return None
    if any(token in value for token in ("{{", "}}", "${", "data:")):
        return None

    parsed = urlsplit(value)
    if parsed.scheme.lower() in {
        "http",
        "https",
        "mailto",
        "tel",
        "javascript",
        "blob",
    }:
        return None

    path_text = unquote(parsed.path)
    if not path_text:
        return None
    if path_text.startswith("/"):
        target = ROOT / path_text.lstrip("/")
    else:
        target = source.parent / path_text
    return target.resolve()


def reference_exists(reference: str, source: Path) -> bool:
    target = local_reference_target(reference, source)
    if target is None:
        return True
    try:
        relative_target = target.relative_to(ROOT)
    except ValueError:
        return False
    if relative_target.as_posix() in OPTIONAL_LOCAL_FILES:
        return True

    candidates = [target]
    if reference.split("?", 1)[0].endswith("/"):
        candidates.append(target / "index.html")
    if not target.suffix:
        candidates.extend((target.with_suffix(".html"), target / "index.html"))
    return any(candidate.is_file() for candidate in candidates)


class SiteHTMLParser(HTMLParser):
    def __init__(self, source: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.source = source
        self.ids: dict[str, int] = {}
        self.references: list[tuple[str, int]] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        line, _ = self.getpos()
        for name, value in attrs:
            if value is None:
                continue
            if name == "id":
                self.ids[value] = self.ids.get(value, 0) + 1
            elif name in {"href", "src", "poster"}:
                self.references.append((value, line))
            elif name == "srcset":
                for item in value.split(","):
                    candidate = item.strip().split(" ", 1)[0]
                    if candidate:
                        self.references.append((candidate, line))


def validate_changed_paths(paths: list[str]) -> list[str]:
    errors: list[str] = []
    blocked = [path for path in paths if is_protected(path)]
    if blocked:
        errors.append("보호 파일 변경 금지: " + ", ".join(blocked))

    for relative in paths:
        path = ROOT / relative
        if path.is_file() and path.stat().st_size > MAX_CHANGED_FILE_BYTES:
            errors.append(f"변경 파일이 12MB를 넘습니다: {relative}")
    return errors


def validate_json_and_javascript() -> list[str]:
    errors: list[str] = []
    for path in ROOT.rglob("*.json"):
        if ".git" in path.parts:
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            errors.append(f"JSON 오류 {path.relative_to(ROOT)}: {exc}")

    for path in ROOT.rglob("*.js"):
        if ".git" in path.parts or ".github" in path.parts:
            continue
        result = subprocess.run(
            ["node", "--check", str(path)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        if result.returncode:
            errors.append(
                f"JavaScript 오류 {path.relative_to(ROOT)}: {result.stdout.strip()}"
            )
    return errors


def validate_html_and_assets() -> list[str]:
    errors: list[str] = []
    for core in CORE_PAGES:
        if not (ROOT / core).is_file():
            errors.append(f"필수 페이지가 없습니다: {core}")

    for path in ROOT.rglob("*.html"):
        if ".git" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
            parser = SiteHTMLParser(path)
            parser.feed(text)
            parser.close()
        except (OSError, UnicodeDecodeError) as exc:
            errors.append(f"HTML 읽기 오류 {path.relative_to(ROOT)}: {exc}")
            continue

        duplicates = sorted(key for key, count in parser.ids.items() if count > 1)
        if duplicates:
            errors.append(
                f"중복 id {path.relative_to(ROOT)}: {', '.join(duplicates)}"
            )
        for reference, line in parser.references:
            if not reference_exists(reference, path):
                errors.append(
                    f"없는 로컬 파일 {path.relative_to(ROOT)}:{line}: {reference}"
                )

    css_url = re.compile(r"url\\(\\s*([\"']?)(.*?)\\1\\s*\\)", re.IGNORECASE)
    for path in ROOT.rglob("*.css"):
        if ".git" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for _, reference in css_url.findall(text):
            if not reference_exists(reference, path):
                errors.append(
                    f"없는 CSS 로컬 파일 {path.relative_to(ROOT)}: {reference}"
                )
    return errors


def validate_conflict_markers() -> list[str]:
    errors: list[str] = []
    marker = re.compile(r"^(<<<<<<< |=======|>>>>>>> )", re.MULTILINE)
    for path in ROOT.rglob("*"):
        if (
            not path.is_file()
            or path.suffix.lower() not in TEXT_SUFFIXES
            or ".git" in path.parts
        ):
            continue
        try:
            if marker.search(path.read_text(encoding="utf-8")):
                errors.append(f"병합 충돌 표시가 남아 있습니다: {path.relative_to(ROOT)}")
        except (OSError, UnicodeDecodeError):
            continue
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", required=True)
    args = parser.parse_args()

    paths = changed_files(args.base, args.head)
    errors = []
    errors.extend(validate_changed_paths(paths))
    errors.extend(validate_json_and_javascript())
    errors.extend(validate_html_and_assets())
    errors.extend(validate_conflict_markers())

    if errors:
        print("사이트 검증 실패:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"사이트 검증 통과: 변경 파일 {len(paths)}개, "
        f"HTML {len(list(ROOT.rglob('*.html')))}개"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
