import struct,glob,sys,collections
import os; repo=os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')) + '/'
files=sorted(glob.glob(repo+'sources/*/downloads/*.tef')+glob.glob(repo+'sources/mandozine/tefs/*.tef'))
rows=[];stats=collections.Counter();byteset=collections.defaultdict(collections.Counter)
for f in files:
    d=open(f,'rb').read()
    if len(d)<210 or d[205]<10: continue
    try:
        start=struct.unpack_from('<I',d,0x3c)[0]
        toff=struct.unpack_from('<I',d,0x60)[0]
        rl,cnt=struct.unpack_from('<HH',d,toff)
        strs=[struct.unpack_from('<H',d,toff+4+i*rl)[0] for i in range(cnt)] if False else None
        # try record size 68 at toff: u16 68,u16 count
        recs=[struct.unpack_from('<H',d,toff+4+i*68)[0] for i in range(cnt)]
        tot=sum(recs)
    except Exception as e:
        continue
    notes={}
    p=start
    while p+12<=len(d):
        loc=struct.unpack_from('<I',d,p)[0]
        if loc==0xFFFFFFFF:break
        c=d[p+4:p+12]
        notes[loc]=c
        p+=12
    for loc,c in notes.items():
        if loc%8 or tot==0: continue
        idx=loc//8;pos,row=divmod(idx,tot)
        if c[0]&0x1f==0 or c[0]&0x40: continue
        eff=c[2]&0xf
        if eff in(12,13,4):
            stats[(eff)]+=1
            # next note same string
            nxt=None
            for q in range(pos+1,pos+400):
                k=(q*tot+row)*8
                if k in notes and (notes[k][0]&0x1f)>0 and not notes[k][0]&0x40:
                    nxt=(q,notes[k]);break
            # track
            cum=0;tr=0
            for i,r in enumerate(recs):
                if row<cum+r:tr=i;break
                cum+=r
            rows.append((f.split('/')[-1][:28],eff,pos,tr,row-cum,(c[0]&0x1f)-1,c.hex(),(nxt[0]-pos,(nxt[1][0]&0x1f)-1,nxt[1].hex()) if nxt else None))
            if eff in(12,13):
                for i in range(8): byteset[i][c[i]]+=1
print(stats)
for r in rows:
    if r[1] in (12,13): print(r)
print({i:dict(v) for i,v in byteset.items()})
