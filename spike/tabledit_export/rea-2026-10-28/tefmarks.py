import sys, glob, struct, collections
import os; ROOT=os.environ.get('BGB_ROOT', os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

def corpus():
    return sorted(glob.glob(ROOT+'/sources/*/downloads/*.tef')+glob.glob(ROOT+'/sources/mandozine/tefs/*.tef'))

def load_v3(path):
    d=open(path,'rb').read()
    if len(d)<0x100 or d[205]<10: return None
    ts=track_strings(d)
    mt=measure_table(d)
    # measure starts in 64ths
    starts=[];s=0;lens=[]
    for num,den in mt:
        L=64*num//den if (num and den) else 64
        starts.append(s);lens.append(L);s+=L
    ptr=struct.unpack_from('<I',d,0x3c)[0]
    cells=[]  # (pos,row,bytes8)
    o=ptr
    while o+12<=len(d):
        loc=struct.unpack_from('<I',d,o)[0]
        if loc==0xFFFFFFFF: break
        cb=d[o+4:o+12]
        pos,row=divmod(loc//8,ts)
        cells.append((pos,row,cb))
        o+=12
    # stored reading list
    rl=[]
    p=struct.unpack_from('<I',d,0x80)[0]
    if p and p+4<=len(d):
        es,cnt=struct.unpack_from('<HH',d,p)
        if es==0x20:
            for i in range(cnt):
                e=d[p+4+i*es:p+4+(i+1)*es]
                a,b=struct.unpack_from('<HH',e,0)
                lab=e[4:].split(b'\0')[0].decode('latin1')
                rl.append((a,b,lab))
    return dict(path=path,data=d,ts=ts,starts=starts,lens=lens,nm=len(mt),cells=cells,rl=rl)

def measure_of(starts,pos):
    # largest m with starts[m]<=pos
    m=0
    for k,s in enumerate(starts):
        if s<=pos: m=k
        else: break
    return m

def track_strings(d):
    tp=struct.unpack_from('<I',d,0x60)[0]
    if not (0<tp<len(d)-4): return 5
    rs,tc=struct.unpack_from('<HH',d,tp)
    if rs!=68: return 5
    tot=0
    for i in range(tc):
        tot+=struct.unpack_from('<H',d,tp+4+i*rs)[0]
    return tot or 5

def measure_table(d):
    ptr=struct.unpack_from('<I',d,0x5c)[0]
    if not (0<ptr<len(d)-4): return []
    _,count=struct.unpack_from('<HH',d,ptr)
    first=ptr+8
    if not(1<=count<=2048) or first+count*8>len(d): return []
    out=[]
    for j in range(count):
        rec=d[first+j*8:first+(j+1)*8]
        out.append((rec[5],rec[4]))
    return out

def load_v2(path):
    d=open(path,'rb').read()
    if len(d)<260 or d[205]>=10: return None
    nm=struct.unpack_from('<H',d,200)[0]
    num,den=d[202],d[204]
    nrl=d[222]; ns=d[240]; cc=struct.unpack_from('<H',d,256)[0]
    if not(num and den and ns and nm): return None
    ts_size=256*num//den
    stride=4 if 258+6*cc>len(d) else 6
    off=258; m_data=0; m_index=0; cells=[]
    for _ in range(cc):
        if off+stride>len(d): break
        rec=d[off:off+stride]; off+=stride
        loc=rec[0]+256*(m_data+rec[1])
        if loc//(ts_size*ns) < m_index:
            m_data+=256; loc=rec[0]+256*(m_data+rec[1])
        meas=loc//(ts_size*ns); m_index=meas
        within=loc%ts_size; row=(loc//ts_size)%ns
        cells.append((meas,within,row,rec))
    rl=[]
    for i in range(nrl):
        if off+2*i+1>=len(d): break
        rl.append((d[off+2*i],d[off+2*i+1],''))
    return dict(path=path,data=d,nm=nm,cells=cells,rl=rl,stride=stride,ts_size=ts_size)
