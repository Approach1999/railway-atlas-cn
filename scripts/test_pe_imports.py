import struct
import unittest
from pe_imports import read_imports


def fixture():
    raw = bytearray(2048)
    raw[:2] = b'MZ'
    struct.pack_into('<I', raw, 0x3c, 0x80)
    raw[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', raw, 0x84, 0x8664, 1)
    struct.pack_into('<H', raw, 0x94, 240)
    optional = 0x98
    struct.pack_into('<H', raw, optional, 0x20b)
    struct.pack_into('<Q', raw, optional + 24, 0x180000000)
    struct.pack_into('<I', raw, optional + 60, 512)
    struct.pack_into('<I', raw, optional + 108, 16)
    struct.pack_into('<II', raw, optional + 120, 0x1000, 40)
    struct.pack_into('<II', raw, optional + 112 + 13 * 8, 0x1080, 64)
    section = optional + 240
    struct.pack_into('<IIII', raw, section + 8, 1536, 0x1000, 1536, 512)
    struct.pack_into('<IIIII', raw, 512, 0, 0, 0, 0x1100, 0)
    raw[768:781] = b'python312.dll'
    struct.pack_into('<IIIIIIII', raw, 640, 1, 0x1120, 0, 0, 0, 0, 0, 0)
    raw[800:812] = b'optional.dll'
    return raw


class PEImportTests(unittest.TestCase):
    def test_normal_and_delayed_imports_are_read_without_execution(self):
        self.assertEqual(read_imports(fixture()), {'machine': '0x8664', 'format': 'PE32+',
            'imports': ['python312.dll'], 'delay_imports': ['optional.dll']})

    def test_missing_signatures_truncation_and_unmapped_addresses_fail(self):
        for data in [b'', b'MZ', fixture()[:100], b'xx' + fixture()[2:]]:
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                read_imports(data)
        raw = fixture()
        struct.pack_into('<I', raw, 524, 0xfffff)
        with self.assertRaisesRegex(ValueError, 'Unmapped'):
            read_imports(raw)

    def test_import_table_must_end_and_names_cannot_be_paths(self):
        raw = fixture()
        struct.pack_into('<I', raw, 0x98 + 124, 20)
        with self.assertRaisesRegex(ValueError, 'terminator'):
            read_imports(raw)
        raw = fixture()
        raw[768:781] = b'../python.dll'
        with self.assertRaisesRegex(ValueError, 'DLL name'):
            read_imports(raw)


if __name__ == '__main__':
    unittest.main()
