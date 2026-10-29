import struct,glob,collections
import os; repo=os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')) + '/'
files=sorted(glob.glob(repo+'sources/*/downloads/*.tef')+glob.glob(repo+'sources/mandozine/tefs/*.tef'))
c=collections.Counter();fc=collections.Counter();nf=0
for f in files:
    d=open(f,'rb').read()
    if len(d)<210 or d[205]<10: continue
    nf+=1
    p=struct.unpack_from('<I',d,0x3c)[0];local=collections.Counter()
    while p+12<=len(d):
        loc=struct.unpack_from('<I',d,p)[0]
        if loc==0xFFFFFFFF:break
        b=d[p+4:p+12]
        if loc%8==0 and 0<(b[0]&0x1f) and not b[0]&0x40: local[b[1]>>5]+=1
        p+=12
    c.update(local)
    if local: fc[local.most_common(1)[0][0]]+=1
print(nf,'v3 files');print('dyn histogram',sorted(c.items()));print('per-file modal dyn',sorted(fc.items()))
