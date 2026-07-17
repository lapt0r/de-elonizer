"""Generate minimal PNG icons for the extension using only stdlib."""
import struct, zlib, os

def make_png(size, bg=(16, 16, 16), fg=(46, 204, 113)):
    """Solid square with a simple X-strike letter E drawn in fg on bg."""
    w, h = size, size
    img = [bg] * (w * h)

    def px(x, y, color):
        if 0 <= x < w and 0 <= y < h:
            img[y * w + x] = color

    def fill_rect(x0, y0, x1, y1, color):
        for yy in range(y0, y1):
            for xx in range(x0, x1):
                px(xx, yy, color)

    # Draw a stylised "Ø" (E with strikethrough) — easier: just draw a circle with an X
    # Actually: draw letter E with a red diagonal strike for clarity at small sizes.
    # We'll draw a rounded rectangle then an E glyph in fg, plus a red slash.
    m = max(1, size // 16)  # margin unit

    # Background rounded square (we just fill the whole icon with bg)
    fill_rect(0, 0, w, h, bg)

    # Draw E-shape in fg, centred
    ex = size // 5
    ey = size // 5
    ew = size * 3 // 5
    eh = size * 3 // 5
    t = max(1, size // 8)  # stroke thickness

    # Left vertical bar
    fill_rect(ex, ey, ex + t, ey + eh, fg)
    # Top horizontal
    fill_rect(ex, ey, ex + ew, ey + t, fg)
    # Middle horizontal
    fill_rect(ex, ey + eh // 2 - t // 2, ex + ew * 4 // 5, ey + eh // 2 + t - t // 2, fg)
    # Bottom horizontal
    fill_rect(ex, ey + eh - t, ex + ew, ey + eh, fg)

    # Red diagonal strike (top-right to bottom-left)
    red = (231, 76, 60)
    for i in range(size):
        xi = size - 1 - i
        for dt in range(-t, t + 1):
            if 0 <= xi + dt < w:
                px(xi + dt, i, red)

    # Build PNG bytes
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            r, g, b = img[y * w + x]
            raw += bytes([r, g, b])

    compressed = zlib.compress(raw, 9)
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', compressed)
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend


out = os.path.join(os.path.dirname(__file__), 'extension', 'icons')
for size in (16, 32, 48, 128):
    with open(f'{out}/icon-{size}.png', 'wb') as f:
        f.write(make_png(size))
    print(f'  icon-{size}.png written')
