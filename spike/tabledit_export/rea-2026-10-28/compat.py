import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import *
def pickup_v3(path):
    t=load_v3(path); 
    return bool(t and len(t['lens'])>1 and t['lens'][0]<t['lens'][1])
def pickup_v2(path):
    d=open(path,'rb').read(); return struct.unpack_from('<H',d,244)[0]==1
def prep2(fl,pickup):
    fl=list(fl); n=len(fl)
    start=1 if pickup else 0; has=False; i=0
    # sections: end markers 0x80 (repeat end); 0x08 with low2 (ending 2 closes bracket)
    for i,f in enumerate(fl):
        if f&0x40: start=i; has=True
        if f&0x80 and not has:
            if not (i==0): fl[start]|=0x40
            has=True
        if (f&0x80) or (f&0x0a)==0x0a or (f&0x88)==0x88:
            # section closes at measure i unless a following ending-2 measure extends it
            nxt=fl[i+1] if i+1<n else 0
            if (f&0x80) and (f&7)==1 and (nxt&7)==2: continue   # ending bracket continues
            start=i+1; has=False
    return fl
if __name__=='__main__':
    ok=tot=0; bad=[]
    paths={f.split('/')[-1]:f for f in corpus()}
    for name,fl,k,st in collect():
        if not(k and st): continue
        tot+=1
        p=paths[name]; d=open(p,'rb').read()
        pk=pickup_v3(p) if d[205]>=10 else pickup_v2(p)
        der=derive(prep2(fl,pk))
        if der==st: ok+=1
        else: bad.append((name,pk,der,st))
    print('compat match',ok,'/',tot)
    for b in bad[:14]: print(b)
