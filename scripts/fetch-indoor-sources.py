#!/usr/bin/env python3
"""Download public floor-plan files from the reviewed research catalogs.

python scripts/fetch-indoor-sources.py --list
python scripts/fetch-indoor-sources.py --buildings CSB SME EBU1 EBU2 PFBH

No third-party packages. Downloads stay in ignored local/indoor-sources/;
each successful file gets a SHA-256 and acquisition record. A catalog entry
is a research lead, not a claim that a binary or room geometry was obtained.
"""

import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 40 * 1024 * 1024


def sources():
    found = {}
    for path in sorted((ROOT / "data/indoor/research").glob("*-sources.json")):
        catalog = json.loads(path.read_text())
        for source in catalog.get("sources", []):
            # Tile acquisitions and service audits use separate schemas/tools.
            if "buildings" not in source or "format" not in source:
                continue
            source = {**source, "catalog": str(path.relative_to(ROOT))}
            if source["id"] in found:
                raise ValueError(f"Duplicate source ID: {source['id']}")
            found[source["id"]] = source
    return list(found.values())


def file_kind(source):
    fmt = source.get("format", "").lower()
    if fmt in ("pdf", "application/pdf"):
        return "pdf"
    if fmt in ("jpg", "jpeg", "image/jpeg"):
        return "jpg"
    if fmt in ("png", "image/png"):
        return "png"
    return None


def validate_body(body, kind):
    signatures = {"pdf": b"%PDF-", "jpg": b"\xff\xd8\xff", "png": b"\x89PNG\r\n\x1a\n"}
    if not body.startswith(signatures[kind]):
        raise ValueError("Response is not the expected file type (possibly a login, error, or download-confirmation page)")


def download(source, destination):
    url = source.get("downloadUrl") or source["url"]
    parsed = urllib.parse.urlsplit(url)
    # Use Google's documented public-file download route for shared PDF links.
    match = re.fullmatch(r"/file/d/([A-Za-z0-9_-]+)/view", parsed.path)
    if parsed.hostname == "drive.google.com" and match:
        url = "https://drive.google.com/uc?export=download&id=" + match[1]
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("Only HTTPS source URLs are supported")
    kind = file_kind(source)
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", source["id"])
    target = destination / f"{safe_id}.{kind}"
    metadata = destination / f"{safe_id}.json"
    if target.exists() and metadata.exists():
        record = json.loads(metadata.read_text())
        body = target.read_bytes()
        validate_body(body, kind)
        if record["sha256"] != hashlib.sha256(body).hexdigest():
            raise ValueError(f"Cached checksum mismatch: {target}")
        if record.get("sourceUrl") != source["url"]:
            raise ValueError("Catalog URL changed; review cached provenance before replacing the file")
        return {**record, "status": "cached"}
    request = urllib.request.Request(url, headers={"User-Agent": "UCSD-Classroom-Explorer-source-acquisition/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Source exceeds the 40 MiB download limit")
        validate_body(body, kind)
        record = {
            "id": source["id"], "status": "downloaded", "sourceUrl": source["url"],
            "downloadUrl": url, "resolvedUrl": response.url, "catalog": source["catalog"],
            "acquiredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
            "contentType": response.headers.get("Content-Type"),
            "etag": response.headers.get("ETag"), "lastModified": response.headers.get("Last-Modified"),
            "file": str(target), "geometryReviewed": False,
        }
    destination.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    partial.write_bytes(body)
    partial.replace(target)
    metadata.write_text(json.dumps(record, indent=2) + "\n")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="List sources without using the network")
    parser.add_argument("--buildings", nargs="+", help="Only sources for these registrar codes")
    parser.add_argument("--ids", nargs="+", help="Only these exact source IDs")
    parser.add_argument("--output", type=Path, default=ROOT / "local/indoor-sources")
    args = parser.parse_args()
    selected = [s for s in sources() if
                (not args.buildings or set(args.buildings) & set(s["buildings"])) and
                (not args.ids or s["id"] in args.ids)]
    if not selected:
        parser.error("No sources match the selection")
    if args.list:
        for source in selected:
            print(f"{source['id']}\t{','.join(source['buildings'])}\t{file_kind(source) or 'index/lead'}\t{source['url']}")
        return
    results = []
    attempted = False
    for source in selected:
        if not file_kind(source):
            print(f"SKIP {source['id']}: index/access page, open in a browser")
            continue
        if attempted:
            time.sleep(4)
        attempted = True
        try:
            record = download(source, args.output)
            results.append(record)
            print(f"{record['status'].upper()} {source['id']} ({record['bytes']} bytes)", flush=True)
        except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
            results.append({"id": source["id"], "status": "failed", "sourceUrl": source["url"], "error": str(error)})
            print(f"FAILED {source['id']}: {error}", file=sys.stderr, flush=True)
            # Stop on the first error: do not hammer an unavailable host or
            # turn an access page into attempts at authenticated endpoints.
            break
    if results:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "last-run.json").write_text(json.dumps(results, indent=2) + "\n")
    if any(r["status"] == "failed" for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
