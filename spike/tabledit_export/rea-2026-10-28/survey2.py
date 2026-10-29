import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
v3=v2=0; withm=0; withrl=0; both=0;
for f in corpus():
    d=open(f,'rb').read()
    if len(d)<0x100: continue
    if d[205]<10: v2+=1; continue
    v3+=1
    t=load_v3(f)
    m=[c for c in t['cells'] if c[2][0]==0xb7]
    if m: withm+=1
    if t['rl']: withrl+=1
    if m and t['rl']: both+=1
print(v3,v2,withm,withrl,both)
