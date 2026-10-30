"""Read PE normal/delay import names without loading or executing a binary."""
import struct


def read_imports(raw):
    def number(offset, kind='I'):
        size = struct.calcsize('<' + kind)
        if offset < 0 or offset + size > len(raw):
            raise ValueError('Truncated PE structure')
        return struct.unpack_from('<' + kind, raw, offset)[0]

    if raw[:2] != b'MZ':
        raise ValueError('Missing DOS signature')
    pe = number(0x3c)
    if raw[pe:pe + 4] != b'PE\0\0':
        raise ValueError('Missing PE signature')
    machine, sections, optional_size = number(pe + 4, 'H'), number(pe + 6, 'H'), number(pe + 20, 'H')
    optional = pe + 24
    magic = number(optional, 'H')
    if magic not in (0x10b, 0x20b):
        raise ValueError('Unsupported PE optional header')
    directory_offset = optional + (112 if magic == 0x20b else 96)
    count_offset = optional + (108 if magic == 0x20b else 92)
    directory_count = number(count_offset)
    image_base = number(optional + (24 if magic == 0x20b else 28), 'Q' if magic == 0x20b else 'I')
    if optional + optional_size > len(raw) or sections > 96:
        raise ValueError('Invalid PE section table')
    table = optional + optional_size
    mappings = []
    for index in range(sections):
        start = table + index * 40
        virtual_size, virtual_address = number(start + 8), number(start + 12)
        raw_size, raw_offset = number(start + 16), number(start + 20)
        mappings.append((virtual_address, virtual_size, raw_size, raw_offset))

    def address(rva):
        if rva < number(optional + 60) and rva < len(raw):
            return rva
        for va, virtual_size, size, offset in mappings:
            if va <= rva < va + max(virtual_size, size):
                delta = rva - va
                if delta >= size or offset + delta >= len(raw):
                    raise ValueError('PE import points outside file-backed section')
                return offset + delta
        raise ValueError('Unmapped PE import address')

    def directory(index):
        if index >= directory_count:
            return 0, 0
        offset = directory_offset + index * 8
        if offset + 8 > optional + optional_size:
            raise ValueError('PE data directory exceeds optional header')
        return number(offset), number(offset + 4)

    def text(rva):
        offset = address(rva)
        end = raw.find(b'\0', offset, min(len(raw), offset + 1024))
        if end < 0:
            raise ValueError('Unterminated PE import name')
        value = raw[offset:end].decode('ascii')
        if not value or '/' in value or '\\' in value:
            raise ValueError('Invalid PE import DLL name')
        return value

    def names(index, stride, name_offset, delayed=False):
        rva, size = directory(index)
        if not rva:
            return []
        base = address(rva)
        found = []
        for offset in range(0, min(size, 4096 * stride), stride):
            if base + offset + stride > len(raw):
                raise ValueError('Truncated PE import descriptor')
            descriptor = raw[base + offset:base + offset + stride]
            if not any(descriptor):
                return sorted(set(found), key=str.lower)
            name = number(base + offset + name_offset)
            if delayed and not number(base + offset) & 1:
                name -= image_base
            found.append(text(name))
        raise ValueError('PE import descriptor table has no terminator')

    return {'machine': hex(machine), 'format': 'PE32+' if magic == 0x20b else 'PE32',
            'imports': names(1, 20, 12), 'delay_imports': names(13, 32, 4, True)}
