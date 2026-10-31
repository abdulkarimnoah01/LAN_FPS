import json, struct, io, sys
from PIL import Image
src, dst, MAX = sys.argv[1], sys.argv[2], 1024
b = open(src, 'rb').read()
n = struct.unpack_from('<I', b, 12)[0]
j = json.loads(b[20:20+n])
bo = 20 + n
bn = struct.unpack_from('<I', b, bo)[0]
bin0 = b[bo+8:bo+8+bn]
img_bvs = {im['bufferView']: im for im in j['images']}
out = bytearray()
for i, bv in enumerate(j['bufferViews']):
    data = bin0[bv.get('byteOffset', 0):bv.get('byteOffset', 0)+bv['byteLength']]
    if i in img_bvs:
        im = img_bvs[i]
        pic = Image.open(io.BytesIO(data)); pic.load()
        pic.thumbnail((MAX, MAX), Image.LANCZOS)
        buf = io.BytesIO()
        has_alpha = pic.mode in ('RGBA', 'LA') and pic.getchannel('A').getextrema()[0] < 255
        if has_alpha: pic.save(buf, 'PNG', optimize=True); im['mimeType'] = 'image/png'
        else: pic.convert('RGB').save(buf, 'JPEG', quality=88); im['mimeType'] = 'image/jpeg'
        data = buf.getvalue()
        print(im.get('name'), pic.size, 'alpha' if has_alpha else 'rgb', len(data))
    while len(out) % 4: out.append(0)
    bv['byteOffset'] = len(out); bv['byteLength'] = len(data); out += data
while len(out) % 4: out.append(0)
j['buffers'][0]['byteLength'] = len(out)
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
total = 12 + 8 + len(js) + 8 + len(out)
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + out)
print('->', total)
