import unittest
import extract_region
from survey_region import bounds, inside, rail_object, reaches


class SurveyTests(unittest.TestCase):
    def test_envelope_tests_cover_points_boxes_and_the_edges(self):
        envelope = [121.1, 38.74, 122.05, 39.47]
        self.assertTrue(inside([121.6, 39.0], envelope))
        self.assertTrue(inside([121.1, 38.74], envelope))
        self.assertFalse(inside([122.06, 39.0], envelope))
        self.assertFalse(inside([121.0, 39.0], envelope))
        # A box reaches the envelope when it overlaps any part of it, including a ring around it;
        # sharing only an edge still counts, so nothing on the boundary is missed.
        self.assertTrue(reaches([121.5, 39.0, 121.6, 39.1], envelope))
        self.assertTrue(reaches([120.0, 38.0, 123.0, 40.0], envelope))
        self.assertTrue(reaches([121.2, 38.7, 121.3, 38.74], envelope))
        self.assertFalse(reaches([122.1, 39.0, 122.2, 39.1], envelope))
        self.assertFalse(reaches([121.2, 38.6, 121.3, 38.739], envelope))
        self.assertFalse(reaches(None, envelope))

    def test_union_box_is_ordered_and_empty_only_for_no_input(self):
        self.assertIsNone(bounds([]))
        self.assertEqual(bounds([[2, 2, 3, 3], [0, 1, 4, 2]]), [0, 1, 4, 3])
        self.assertEqual(bounds([[121.5, 39.0, 121.5, 39.0]]), [121.5, 39.0, 121.5, 39.0])

    def test_survey_counts_exactly_what_the_extractor_selects(self):
        # One definition of a rail object: lifecycle prefixes and rail-context public transport stops count.
        for tags in [{"railway": "rail"}, {"disused:railway": "rail"}, {"public_transport": "platform", "tram": "yes"},
                     {"public_transport": "platform", "bus": "yes"}, {"highway": "primary"}]:
            self.assertIs(rail_object(tags), extract_region.rail_object(tags), tags)
        self.assertTrue(rail_object({"public_transport": "platform", "tram": "yes"}))
        self.assertFalse(rail_object({"public_transport": "platform", "bus": "yes"}))
        self.assertFalse(rail_object({"highway": "primary"}))


if __name__ == "__main__":
    unittest.main()
