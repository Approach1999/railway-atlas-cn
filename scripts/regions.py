"""Region registry shared by the data scripts.

config/catalog.json is the single configured source of region identities,
boundaries, default views and data entry points. Scripts accept --region and
resolve through this module instead of naming one city.
"""
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CATALOG = "config/catalog.json"
KEY = re.compile(r"[A-Za-z0-9_-]{1,80}")


class RegionError(ValueError):
    """The registry or a region file does not describe a usable region."""


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def inside_root(root, relative):
    """Resolve a repository-relative configured path; it may not escape the root."""
    if not isinstance(relative, str) or not relative:
        raise RegionError(f"Configured path is missing: {relative!r}")
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise RegionError(f"Configured path escapes the repository: {relative}")
    return path


def catalog(root=ROOT):
    """Validated registry: unique key identities and a configured default region."""
    config = read(Path(root) / CATALOG)
    regions = config.get("regions") if isinstance(config, dict) else None
    if not isinstance(config, dict) or config.get("schema_version") != 1 or not isinstance(regions, list) or not regions:
        raise RegionError("Region registry must declare schema_version 1 and at least one region")
    ids = [region.get("id") if isinstance(region, dict) else None for region in regions]
    if any(not isinstance(value, str) or not KEY.fullmatch(value) for value in ids):
        raise RegionError("Region identities may only use letters, digits, '-' and '_' (1 to 80 characters)")
    if len(set(ids)) != len(ids):
        raise RegionError("Region identities must be unique")
    if config.get("default_region") not in ids:
        raise RegionError("default_region must name a configured region")
    return config


def default_region(root=ROOT):
    return catalog(root)["default_region"]


def region_argument(parser, root=ROOT):
    """Declare --region with the registry default; an unreadable registry is a usage error."""
    try:
        default = default_region(root)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    parser.add_argument("--region", default=default,
        help="Configured region id (default: the registry default); its boundary and description come from the registry")
    return parser


def region_entry(region, root=ROOT):
    if not isinstance(region, str):
        raise RegionError("Region identity must be text")
    for entry in catalog(root)["regions"]:
        if entry["id"] == region:
            return entry
    raise RegionError(f"Region is not configured: {region}")


def extraction_config(region, root=ROOT):
    """Bounded rectangle and filters; the file's own id must agree with the registry."""
    entry = region_entry(region, root)
    config = read(inside_root(root, entry.get("pipeline", {}).get("region_config")))
    bbox = config.get("bbox")
    ordered = (isinstance(bbox, list) and len(bbox) == 4
        and all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in bbox)
        and -180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90)
    if config.get("id") != region or not ordered:
        raise RegionError(f"Extraction config for {region} must carry the same id and an ordered WGS84 bbox")
    return config


def preview_config(region, root=ROOT):
    """Per-region editorial station lists and evidence-backed mode overrides."""
    entry = region_entry(region, root)
    return read(inside_root(root, entry.get("pipeline", {}).get("preview_config")))
