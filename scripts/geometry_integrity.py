"""Published detail geometry invariants; never repair or move source coordinates.

Closed paths may repeat their first position once at the end. Repeated positions
elsewhere, zero-length edges, and zero-area rings require review before release.
This is not a polygon topology/intersection or real-world position audit.
"""
import math


def validate_geometry(geometry, feature_key="geometry"):
    def fail(code, location):
        raise ValueError(f"{feature_key}: {code} at {location}")

    stats = {"positions": 0, "line_parts": 0, "polygon_rings": 0}

    def position(value, location):
        if not isinstance(value, list) or len(value) != 2:
            fail("invalid_position", location)
        for axis, bound in enumerate((180, 90)):
            number = value[axis]
            if type(number) not in (int, float) or not -bound <= number <= bound or not math.isfinite(number):
                fail("invalid_wgs84_coordinate", f"{location}[{axis}]")
        stats["positions"] += 1
        return tuple(value)

    def path(value, location, ring=False):
        if not isinstance(value, list) or len(value) < (4 if ring else 2):
            fail("too_few_positions", location)
        points = [position(p, f"{location}[{i}]") for i, p in enumerate(value)]
        for i in range(1, len(points)):
            if points[i] == points[i - 1]:
                fail("zero_length_edge", f"{location}[{i}]")
        closed = points[0] == points[-1]
        if ring and not closed:
            fail("unclosed_ring", location)
        unique_path = points[:-1] if closed else points
        if len(set(unique_path)) != len(unique_path):
            fail("repeated_nonclosing_position", location)
        if ring:
            # Translate to a local origin to avoid cancellation of large lon/lat products.
            x0, y0 = points[0]
            area2 = math.fsum((a[0] - x0) * (b[1] - y0) - (b[0] - x0) * (a[1] - y0)
                              for a, b in zip(points, points[1:]))
            if area2 == 0:
                fail("zero_area_ring", location)
            stats["polygon_rings"] += 1
        else:
            stats["line_parts"] += 1

    if not isinstance(geometry, dict):
        fail("invalid_geometry", "geometry")
    kind, coordinates = geometry.get("type"), geometry.get("coordinates")
    if kind == "Point":
        position(coordinates, "coordinates")
    elif kind == "LineString":
        path(coordinates, "coordinates")
    elif kind in ("MultiLineString", "Polygon"):
        if not isinstance(coordinates, list) or not coordinates:
            fail("empty_geometry_parts", "coordinates")
        for i, part in enumerate(coordinates):
            path(part, f"coordinates[{i}]", ring=kind == "Polygon")
    else:
        # Raw detail schema accepts these four types; clipped MVT MultiPolygon is separate.
        fail("unsupported_detail_geometry", "type")
    return {"type": kind, **stats}
