# Traces design/inlays/*.svg from the supplier photo; see README.md.
from PIL import Image, ImageFilter
import subprocess, re
im=Image.open('eagles.jpg').convert('RGB'); px=im.load()
x0,x1=40,300
bands=[(27,433),(479,572),(588,672),(698,791),(812,872),(903,952),(976,1032),(1046,1099),(1117,1157),(1178,1217),(1242,1287),(24,58)]
names=['peghead']+['marker-%02d'%i for i in range(1,11)]+['diamond']
def on(x,y):
    r,g,b=px[x,y]
    if b-r>60 and g-r>40: return False
    return (r+g+b)/3>70
S=6
for (y0,y1),n in zip(bands,names):
    xa,xb=(120,175) if n=='diamond' else (x0,x1)
    xs=[x for x in range(xa,xb) for y in range(y0,y1) if on(x,y)]
    bx0,bx1=min(xs)-3,max(xs)+4; by0,by1=y0-3,y1+3
    w,h=bx1-bx0,by1-by0
    m=Image.new('L',(w,h),0)
    mp=m.load()
    for x in range(w):
        for y in range(h):
            if xa<=bx0+x<xb and on(bx0+x,by0+y): mp[x,y]=255
    m=m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))  # close pearl-figure gaps
    m=m.resize((w*S,h*S),Image.BICUBIC).filter(ImageFilter.GaussianBlur(S*0.6))
    m=m.point(lambda v:0 if v>128 else 255).convert('1')   # shape black for potrace
    m.save('pbm/%s.pbm'%n)
    subprocess.run(['potrace','-s','-t','40','-a','1.1','-O','0.4','pbm/%s.pbm'%n,'-o','svg/%s.svg'%n],check=True)
    s=open('svg/%s.svg'%n).read()
    s=re.sub(r'<\?xml.*?\?>\s*','',s,flags=re.S); s=re.sub(r'<!DOCTYPE.*?>\s*','',s,flags=re.S)
    s=re.sub(r'<metadata>.*?</metadata>\s*','',s,flags=re.S)
    s=s.replace('fill="#000000"','fill="currentColor"')
    s=re.sub(r'width="[\d.]+pt" height="[\d.]+pt"','width="%d" height="%d"'%(w,h),s)
    open('svg/%s.svg'%n,'w').write(s)
    print(n,w,h,len(s))
