import sys,ast
from pathlib import Path
sys.path.insert(0,r'C:\Users\22673\AppData\Local\uv\cache\archive-v0\4DlIoc7cifau5IH2')
import cv2
import numpy as np
from PIL import Image
P=Path(__file__).parent
B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
tree=ast.parse((P/'whole_people.py').read_text(encoding='utf-8'))
values={}
for node in ast.walk(tree):
    if isinstance(node,ast.Assign):
        for t in node.targets:
            if isinstance(t,ast.Name) and t.id in ('outlines','outline'):
                values[t.id]=ast.literal_eval(node.value)
files={name:B/(name+'.png') for name in values['outlines']}
files['mentor']=Path(r'C:\Users\22673\Desktop\Anthropic\.codex-remote-attachments\01a07900-7a8c-7c81-af8a-8006f8ab8a9c\5bedc610-92f7-40dc-80ac-95a94c0bc049\1-Photo-1.jpg')
out=P/'cutouts'; out.mkdir(exist_ok=True)
for name,path in files.items():
    im=np.array(Image.open(path).convert('RGB'))
    h,w=im.shape[:2]; scale= min(1,800/max(w,h))
    small=cv2.resize(im,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA)
    poly=values['outline'] if name=='mentor' else values['outlines'][name]
    shape=np.zeros(small.shape[:2],np.uint8)
    cv2.fillPoly(shape,[np.array(poly,np.float32).__mul__(scale).astype(np.int32)],255)
    mask=np.full(shape.shape,cv2.GC_PR_BGD,np.uint8)
    mask[shape>0]=cv2.GC_PR_FGD
    dil=cv2.dilate(shape,np.ones((45,45),np.uint8))
    mask[dil==0]=cv2.GC_BGD
    er=cv2.erode(shape,np.ones((35,35),np.uint8))>0
    rgb=small.astype(np.int16)
    dark=rgb.mean(2)<70
    skin=(rgb[:,:,0]-rgb[:,:,2]>12)&(rgb[:,:,0]-rgb[:,:,1]>3)
    mask[er&(dark|skin)]=cv2.GC_FGD
    # Protect the central body and face while the exterior is optimized.
    cv2.grabCut(cv2.cvtColor(small,cv2.COLOR_RGB2BGR),mask,None,
                np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),7,cv2.GC_INIT_WITH_MASK)
    binary=np.where((mask==1)|(mask==3),255,0).astype(np.uint8)
    n,l,stats,c=cv2.connectedComponentsWithStats(binary)
    if n>1:
        binary=np.where(l==1+np.argmax(stats[1:,cv2.CC_STAT_AREA]),255,0).astype(np.uint8)
    alpha=cv2.resize(binary,(w,h),interpolation=cv2.INTER_LINEAR)
    alpha=cv2.GaussianBlur(alpha,(3,3),.55)
    Image.fromarray(np.dstack([im,alpha])).save(out/(name+'.png'))
    print(name,flush=True)
# Independent inspection sheet, preserving the actual masks.
sheet=Image.new('RGB',(1200,1200),(80,95,105))
for i,name in enumerate(files):
    im=Image.open(out/(name+'.png')); im.thumbnail((390,570))
    sheet.paste(im,((i%3)*400,(i//3)*600),im)
sheet.save(P/'cutout-review.png')
