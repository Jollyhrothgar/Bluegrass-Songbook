import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
from derive import derive
ok=bad=0; rows=[]
for f in corpus():
    t=load_v3(f)
    if not t or not t['nm']: continue
    fl=[0]*t['nm']
    marks=[c for c in t['cells'] if c[2][0]==0xb7]
    for pos,row,cb in marks:
        m=measure_of(t['starts'],pos)
        fl[m]|=cb[2]
    if not marks and not t['rl']: continue
    der=derive(fl)
    st=[(a,min(b,t['nm'])) for a,b,l in t['rl']]
    name=f.split('/')[-1]
    if marks and t['rl']:
        if der==st: ok+=1
        else:
            bad+=1; rows.append((name,len(marks),der,st,[(measure_of(t['starts'],c[0])+1,hex(c[2][2])) for c in marks]))
    elif marks:
        print('MARKS-ONLY',name,'nm',t['nm'],[(measure_of(t['starts'],c[0])+1,hex(c[2][2])) for c in marks],'->',der)
    else:
        pass
print('V3 match',ok,'mismatch',bad)
for r in rows: print(r[0],'marks',r[4],'\n  derived',r[2],'\n  stored ',r[3])
