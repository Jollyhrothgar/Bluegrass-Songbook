import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
bc=collections.Counter(); b1=collections.Counter(); b3=collections.Counter(); rest=collections.Counter()
n=0
for f in corpus():
    t=load_v3(f)
    if not t: continue
    for pos,row,cb in t['cells']:
        if cb[0]==0xb7:
            n+=1; bc[cb[2]]+=1; b1[cb[1]]+=1; b3[cb[3]]+=1; rest[cb[4:].hex()]+=1
print(n); print('byte2',sorted((hex(k),v) for k,v in bc.items())); print('byte1',b1); print('byte3',b3); print('b4-7',rest)
