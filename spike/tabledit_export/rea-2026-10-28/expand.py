import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import *
import collections
def exp(l):
    s=[]
    for a,b in l:
        s+= list(range(a,b+1)) if a<=b else []
    return s
data=collect()
cat=collections.Counter(); ex=[]
for name,fl,k,st in data:
    if not(k and st): continue
    d=derive(fl)
    if d==st: cat['exact']+=1; continue
    if exp(d)==exp(st): cat['same-playback']+=1; continue
    # classify
    hasend=any(f&0x80 for f in fl); hasstart=any(f&0x40 for f in fl); has7=any(f&7==7 for f in fl)
    trivial = d==[(1,len(fl))]
    key=('derived-trivial(1..n)' if trivial else 'derived-nontrivial', 'stored-trivial' if st==[(1,len(fl))] else 'stored-nontrivial')
    cat[key]+=1
    if not trivial: ex.append((name,len(fl),d,st))
print(cat)
for e in ex[:12]: print(e)
