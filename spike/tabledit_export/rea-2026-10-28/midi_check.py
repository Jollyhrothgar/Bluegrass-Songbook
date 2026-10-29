import sys, struct, collections
sys.path.insert(0, 'spike')
from midi_reader import read_midi
def tef_dyns(path):
    d=open(path,'rb').read(); p=struct.unpack_from('<I',d,0x3c)[0]; c=collections.Counter()
    while p+12<=len(d):
        loc=struct.unpack_from('<I',d,p)[0]
        if loc==0xffffffff: break
        t=d[p+4]
        if (t&0x3f)<0x33 and 1<=(t&0x1f)<=0x19: c[d[p+5]>>5]+=1
        p+=12
    return c
for name in ['27493','23398']:
    m=read_midi(f'spike/oracle/{name}.mid')
    vel=collections.Counter(n.velocity for t in m.tracks for n in t.notes)
    print(name,'MIDI velocities',sorted(vel.items()))
    try: print(name,'TEF dyn codes',sorted(tef_dyns(f'sources/banjo-hangout/downloads/{name}.tef').items()))
    except Exception as e: print('tef',e)
m=read_midi('spike/oracle/Welcome to New York - Bill Emerson.mid')
print('WTNY division',m.division)
for ti,t in enumerate(m.tracks):
    if t.bends:
        bs=[(b.tick,b.channel,b.value-8192) for b in t.bends if b.value!=8192][:12]
        print('track',ti,t.name,'bends(non-center, first 12):',bs)
        for b in [x for x in t.bends if x.value!=8192][:3]:
            near=[(n.tick,n.channel,n.pitch,n.duration) for n in t.notes if n.channel==b.channel and abs(n.tick-b.tick)<=480]
            print('   near',b.tick,'ch',b.channel,':',near)
