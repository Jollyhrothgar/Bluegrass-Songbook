import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
from derive import derive
import collections
ok=bad=0; rows=[]; b2=collections.Counter(); nomark_rl=0; marks_only=[]
files=0
for f in corpus():
    t=load_v2(f)
    if not t: continue
    files+=1
    fl=[0]*t['nm']
    marks=[c for c in t['cells'] if t['stride']==6 and c[3][2]==0x5e]
    for m,w,r,rec in marks:
        if m<t['nm']:
            fl[m]|=rec[4]; b2[rec[4]]+=1
    der=derive(fl) if marks else None
    st=[(a,min(b,t['nm'])) for a,b,l in t['rl']]
    name=f.split('/')[-1]
    if marks and t['rl']:
        if der==st: ok+=1
        else: bad+=1; rows.append((name,[(m+1,w,hex(rec[4])) for m,w,r,rec in marks],der,st))
    elif marks: marks_only.append((name,[(m+1,hex(rec[4])) for m,w,r,rec in marks],der,t['nm']))
print('V2 files',files,'match',ok,'mismatch',bad); print(sorted((hex(k),v) for k,v in b2.items()))
for r in marks_only: print('MARKS-ONLY',r)
import pickle; pickle.dump(rows,open('/tmp/rea-tabledit/v2rows.pkl','wb'))
for r in rows[:int(sys.argv[1]) if len(sys.argv)>1 else 8]: print(r[0],'\n marks',r[1],'\n der',r[2],'\n stored',r[3])
