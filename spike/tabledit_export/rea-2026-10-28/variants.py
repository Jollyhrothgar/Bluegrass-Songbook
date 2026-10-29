import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tefmarks import *
from derive import derive
def prep(fl, mask7=True, implicit=True):
    fl=list(fl); n=len(fl)
    if mask7:
        for i,f in enumerate(fl):
            if f&7==7: fl[i]=f&~7
    if implicit:
        start=0; has_start=False
        for i,f in enumerate(fl):
            if f&0x40: start=i; has_start=True
            if f&0x80:
                if not has_start: fl[start]|=0x40
                start=i+1; has_start=False
    return fl
def collect():
    out=[]
    for f in corpus():
        t=load_v3(f); fl=None
        if t and t['nm']:
            fl=[0]*t['nm']; k=0
            for pos,row,cb in t['cells']:
                if cb[0]==0xb7: fl[measure_of(t['starts'],pos)]|=cb[2]; k+=1
        else:
            t=load_v2(f)
            if not t: continue
            fl=[0]*t['nm']; k=0
            if t['stride']==6:
                for m,w,r,rec in t['cells']:
                    if rec[2]==0x5e and m<t['nm']: fl[m]|=rec[4]; k+=1
        st=[(a,min(b,t['nm'])) for a,b,l in t['rl']]
        out.append((f.split('/')[-1],fl,k,st))
    return out
if __name__=='__main__':
    data=collect()
    for mask7 in (False,True):
        for imp in (False,True):
            ok=tot=0
            for name,fl,k,st in data:
                if k and st:
                    tot+=1
                    if derive(prep(fl,mask7,imp))==st: ok+=1
            print('mask7',mask7,'implicit',imp,'match',ok,'/',tot)
