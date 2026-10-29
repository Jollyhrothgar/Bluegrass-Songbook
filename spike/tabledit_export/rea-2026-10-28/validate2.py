import sys, glob, struct, collections, re
root=sys.argv[1]
files=sorted(glob.glob(root+'/sources/*/downloads/*.tef')+glob.glob(root+'/sources/mandozine/tefs/*.tef')+glob.glob(root+'/tests/parser/fixtures/*.tef'))
NOTE={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
Q=[('maj7',[0,4,7,11]),('M7',[0,4,7,11]),('m7b5',[0,3,6,10]),('dim7',[0,3,6,9]),('dim',[0,3,6]),('aug',[0,4,8]),('+',[0,4,8]),
('m9',[0,3,7,10,2]),('m7',[0,3,7,10]),('m6',[0,3,7,9]),('m',[0,3,7]),('sus4',[0,5,7]),('sus2',[0,2,7]),('sus',[0,5,7]),('9',[0,4,7,10,2]),('7',[0,4,7,10]),('6',[0,4,7,9]),('add9',[0,4,7,2]),('5',[0,7]),('',[0,4,7])]
def expected(name):
    m=re.match(r'^([A-G])([#b]?)(.*?)(?:/([A-G][#b]?))?$',name.strip())
    if not m: return None
    r=NOTE[m.group(1)]+(1 if m.group(2)=='#' else -1 if m.group(2)=='b' else 0)
    q=m.group(3).replace('min','m').replace('maj','maj') 
    q=re.sub(r'\(.*?\)','',q)
    for k,iv in Q:
        if q==k or (k and q.startswith(k)) and k!='' and False: break
    else:
        # prefix match
        for k,iv in Q:
            if k and q.startswith(k): break
        else:
            return None
    s={(r+i)%12 for i in iv}
    # tolerate extensions: add 7th/9th generically
    ext={(r+i)%12 for i in (2,4,5,7,9,10,11)}  # loose
    bass=None
    if m.group(4):
        b=m.group(4); bass=(NOTE[b[0]]+(1 if b[1:]=='#' else -1 if b[1:]=='b' else 0))%12; s.add(bass)
    return r%12,s,bass
tot=0;ok=0;unp=0;bad=[];refd=collections.Counter();rows=collections.Counter();cellstats=collections.Counter()
b2=collections.Counter(); b3=collections.Counter(); b31=collections.Counter(); hi=collections.Counter(); second=0; ex=[]
nfiles=0; dup=0; allff=0
for f in files:
    d=open(f,'rb').read()
    if len(d)<0x100 or d[205]<10: continue
    p=struct.unpack_from('<I',d,0x58)[0]
    if p<0x100: continue
    es,cnt=struct.unpack_from('<HH',d,p)
    if es!=0x24 or cnt==0: continue
    nfiles+=1
    tp=struct.unpack_from('<I',d,0x60)[0]; rs,tc=struct.unpack_from('<HH',d,tp)
    tracks=[];start=0
    for i in range(tc):
        o=tp+4+i*rs; ns=struct.unpack_from('<H',d,o)[0]
        tracks.append(dict(ns=ns,start=start,name=d[o+32:o+68].split(b'\0')[0].decode('latin1'),pitch=[96-b for b in d[o+20:o+20+ns]]))
        start+=ns
    total=start
    recs=[d[p+4+i*es:p+4+(i+1)*es] for i in range(cnt)]
    # grid
    g=struct.unpack_from('<I',d,0x3c)[0]; key=struct.unpack_from('<I',d,0x10)[0]
    ver=(struct.unpack_from('<H',d,2)[0]<<16)|struct.unpack_from('<H',d,4)[0]
    if key and ver>=0x30400b6:
        key=(struct.unpack_from('<I',d,0x3c)[0]*key*struct.unpack_from('<I',d,0x60)[0]*struct.unpack_from('<I',d,0x64)[0])&0xffffffff
    elif key: key=0
    cells=[]
    q=g
    while q+12<=len(d):
        loc=struct.unpack_from('<I',d,q)[0]
        if loc==0xffffffff: break
        c=bytearray(d[q+4:q+12])
        if key:
            v=struct.unpack_from('<I',c,0)[0]^key; c[0:4]=struct.pack('<I',v)
        cells.append((loc,bytes(c))); q+=12
    chordcells={}
    for loc,c in cells:
        if c[0]==0x35:
            idx=loc//8; col,row=divmod(idx,total) if total else (0,0)
            ci=c[1]|c[2]<<8
            chordcells.setdefault(ci,[]).append((col,row,c))
            refd[ci<cnt]+=1
            trk=[t for t in tracks if t['start']<=row<t['start']+t['ns']]
            rows[(len(tracks),row-(trk[0]['start'] if trk else 0), trk[0]['ns'] if trk else -1)]+=1
            cellstats[('b3',c[3])]+=1;cellstats[('b4',c[4])]+=1;cellstats[('b5',c[5])]+=1;cellstats[('b6',c[6])]+=1;cellstats[('b7',c[7])]+=1
    for i,r in enumerate(recs):
        b2[r[0x22]]+=1;b3[r[0x23]]+=1;b31[r[31]]+=1
        name=r[14:31].split(b'\0')[0].decode('latin1')
        use=chordcells.get(i)
        if use: trk=[t for t in tracks if t['start']<=use[0][1]<t['start']+t['ns']][0]
        else: trk=None
        if trk is None:
            c0=[t for t in tracks if t['ns']>=1]
            # guess: track with string count matching played bytes
            trk=None
        if any(x!=0xff for x in r[trk['ns'] if trk else 6:14]): second+=1
        for x in r[:14]:
            if x!=0xff: hi[x>>5]+=1
        if trk is None: 
            unp+=1; continue
        ns=trk['ns']; first=r[31] or 1
        if all(x==0xff for x in r[:14]):
            allff+=1; continue
        pcs=set(); pcl=[]
        for s in range(ns):
            b=r[s]
            if b==0xff: continue
            fr=b&0x1f
            pcs.add((trk['pitch'][s]+fr)%12)
        e=expected(name)
        tot+=1
        if e is None: unp+=1; bad.append((f.split('/')[-1],name,'UNPARSED',r[:ns].hex(),trk['name'])); continue
        root,s,bass=e
        if pcs<=s|{x for x in []} and root in pcs: ok+=1
        elif pcs<=s: ok+=0; bad.append((f.split('/')[-1][:30],name,'noroot',[hex(x) for x in r[:ns]],trk['name'],sorted(pcs),sorted(s)))
        else: bad.append((f.split('/')[-1][:30],name,'mismatch',[hex(x) for x in r[:ns]],trk['name'],sorted(pcs),sorted(s)))
print('files',nfiles,'records scored(with track)',tot,'match(all played pcs in chord & root present)',ok)
print('all-0xff (name-only) records referenced',allff)
print('records unreferenced/unparsed',unp)
print('cell index in range',refd)
print('chord cell (nTracks,row-in-track,ns):',rows.most_common(12))
for k in ('b3','b4','b5','b6','b7'):
    print(k,sorted([(x[1],n) for x,n in cellstats.items() if x[0]==k])[:20])
print('byte0x22',b2,'byte0x23',b3,'byte31',sorted(b31.items()))
print('hi3 counts',sorted(hi.items()),'records with data beyond ns',second)
for b in bad[:25]: print(b)
print(len(bad),'bad total')
