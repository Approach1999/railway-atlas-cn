import unittest
from audit_dependencies import query_osv


class AdvisoryChecks(unittest.TestCase):
    def test_only_paginated_packages_are_requested_again(self):
        queries = [{'package': {'ecosystem': 'npm', 'name': name}, 'version': '1'} for name in ['a', 'b']]
        requests = []

        def request(url, payload):
            requests.append(payload)
            return ({'results': [{'vulns': [{'id': 'A'}], 'next_page_token': 'next'}, {}]}
                    if len(requests) == 1 else {'results': [{'vulns': [{'id': 'B'}]}]})

        results, pages = query_osv(queries, request)
        self.assertEqual(results, [[{'id': 'A'}, {'id': 'B'}], []])
        self.assertEqual(requests[1], {'queries': [{**queries[0], 'page_token': 'next'}]})
        self.assertEqual(len(pages), 2)
        self.assertNotIn('page_token', queries[0])

    def test_failed_or_partial_responses_never_mean_no_advisories(self):
        for response in [{}, {'results': []}, {'results': [{'error': 'backend failed'}]},
                         {'results': [{'vulns': None}]}, {'results': [{'vulns': [{}]}]}]:
            with self.subTest(response=response), self.assertRaises(ValueError):
                query_osv([{}], lambda *_: response)

    def test_repeating_pagination_token_is_incomplete(self):
        with self.assertRaisesRegex(ValueError, 'pagination'):
            query_osv([{}], lambda *_: {'results': [{'next_page_token': 'stuck'}]})


if __name__ == '__main__':
    unittest.main()
