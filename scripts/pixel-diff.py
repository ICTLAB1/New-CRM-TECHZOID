"""Count pixels differing between two greyscale PGMs.

Scattered single pixels are anti-aliasing. A concentrated block in one row
band is a real geometry difference — go and look at the images.
"""
import sys
from collections import Counter


def read_pgm(path):
    d = open(path, "rb").read()
    parts, i = [], 0
    while len(parts) < 4:
        while d[i:i + 1].isspace():
            i += 1
        if d[i:i + 1] == b"#":
            while d[i:i + 1] != b"\n":
                i += 1
            continue
        j = i
        while not d[j:j + 1].isspace():
            j += 1
        parts.append(d[i:j])
        i = j
    i += 1
    w, h = int(parts[1]), int(parts[2])
    return w, h, d[i:i + w * h]


wa, ha, A = read_pgm(sys.argv[1])
wb, hb, B = read_pgm(sys.argv[2])
if (wa, ha) != (wb, hb):
    print(f"DIFFERENT PAGE SIZE: {wa}x{ha} vs {wb}x{hb}")
    sys.exit(1)

bands = Counter()
n = 0
for i in range(len(A)):
    if abs(A[i] - B[i]) > 24:
        n += 1
        bands[(i // wa) // 20 * 20] += 1

pct = 100 * n / len(A)
worst = bands.most_common(1)
print(f"pixels differing: {n} of {len(A)} ({pct:.4f}%)")
if worst:
    band, count = worst[0]
    print(f"worst 20px row band: y {band}-{band + 19} with {count} pixels")
    if count > 400:
        print("  ^ concentrated — likely a REAL difference. Look at the images.")
