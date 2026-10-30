import unittest
from extract_region import intersects, rail_object, segment_intersects


class ExtractTests(unittest.TestCase):
    def test_complete_crossing_way_selected_even_without_inside_nodes(self):
        box = [0, 0, 2, 2]
        self.assertTrue(intersects([[-1, 1], [3, 1]], box))
        self.assertFalse(segment_intersects([-1, 1.5], [1.5, 4], box))
        self.assertFalse(intersects([[-1, 3], [3, 3]], box))
        ring=[[-1,-1],[3,-1],[3,3],[-1,3],[-1,-1]]
        self.assertFalse(intersects(ring, box))
        self.assertTrue(intersects(ring, box, area=True))

    def test_bus_pt_is_not_a_rail_seed_and_lifecycle_only_tracks_are(self):
        self.assertFalse(rail_object({"public_transport": "platform", "bus": "yes"}))
        self.assertTrue(rail_object({"public_transport": "platform", "tram": "yes"}))
        self.assertTrue(rail_object({"construction:railway": "rail"}))


if __name__ == "__main__": unittest.main()
