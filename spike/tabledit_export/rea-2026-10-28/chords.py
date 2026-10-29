import sys, glob, struct, collections
root = sys.argv[1]
files = sorted(glob.glob(root+'/sources/*/downloads/*.tef') + glob.glob(root+'/sources/mandozine/tefs/*.tef') + glob.glob(root+'/tests/parser/fixtures/*.tef'))
tot=0; shown=0
sizes=collections.Counter()
for f in files:
    d=open(f,'rb').read()
    if len(d)<0x100 or d[205]<10: continue
    p=struct.unpack_from('<I',d,88)[0]
    if p<0x100 or p+4>len(d): continue
    es,cnt=struct.unpack_from('<HH',d,p)
    sizes[(es)]+=1
    if cnt==0: continue
    tot+=cnt
    # track info
    tp=struct.unpack_from('<I',d,0x60)[0]; rs,tc=struct.unpack_from('<HH',d,tp)
    tracks=[]
    for i in range(tc):
        o=tp+4+i*rs; ns=struct.unpack_from('<H',d,o)[0]; name=d[o+32:o+68].split(b'\0')[0].decode('latin1')
        tracks.append((ns,name,[96-b for b in d[o+20:o+20+ns]]))
    if shown<14:
        print('##',f.split('/')[-1],'count',cnt,'es',es,'tracks',[(t[0],t[1]) for t in tracks])
        for i in range(min(cnt,6)):
            r=d[p+4+i*es:p+4+(i+1)*es]
            print('  ',r.hex(' '), '|', ''.join(chr(b) if 32<=b<127 else '.' for b in r))
        shown+=1
print('total records',tot,'entry sizes',sizes)
