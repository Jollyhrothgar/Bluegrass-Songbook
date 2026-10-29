import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
import glob
f=glob.glob(ROOT+'/sources/*/downloads/'+sys.argv[1]+'*')[0]
d=open(f,'rb').read()
ptr=struct.unpack_from('<I',d,0x5c)[0]
tag,count=struct.unpack_from('<HH',d,ptr)
print('tag',hex(tag),'count',count, d[ptr:ptr+8].hex(' '))
for j in range(count):
    rec=d[ptr+8+j*8:ptr+16+j*8]
    if any(rec[:4]) or rec[6:]!=b'\0\0' or j<3: print(j+1,rec.hex(' '))
t=load_v3(f)
for c in t['cells']:
    if c[2][0]==0xb7: print('mark m',measure_of(t['starts'],c[0])+1,'pos',c[0],'row',c[1],c[2].hex(' '))
