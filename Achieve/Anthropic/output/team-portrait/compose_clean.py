import sys,ast,json
from pathlib import Path
sys.path.insert(0,r'C:\Users\22673\AppData\Local\uv\cache\archive-v0\4DlIoc7cifau5IH2')
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
P=Path(__file__).parent; B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
room=Image.open(B/'exec-9291e2d1-5843-4422-bb61-2149d4b4ddd0.png').convert('RGB').resize((1086,1448))
# Adjust the empty chair down to the seated source's hip level.
# The surrounding wall/floor is reconstructed from nearby empty horizontal strips.
bg=np.array(room)
for yy in range(790,1448):
    for xx in range(328,800):
        bg[yy,xx]=bg[yy,230+(xx-328)%70]
canvas=Image.fromarray(bg)
chair=room.crop((327,790,800,1330))
cm=np.full((540,473),cv2.GC_PR_BGD,np.uint8)
cm[8:510,35:443]=cv2.GC_PR_FGD
cm[70:210,75:180]=cv2.GC_FGD
cm[:5,:]=cv2.GC_BGD;cm[:,-5:]=cv2.GC_BGD;cm[:,:5]=cv2.GC_BGD
cv2.grabCut(cv2.cvtColor(np.array(chair),cv2.COLOR_RGB2BGR),cm,None,np.zeros((1,65)),np.zeros((1,65)),5,cv2.GC_INIT_WITH_MASK)
ca=Image.fromarray(np.where((cm==1)|(cm==3),255,0).astype('uint8')).filter(ImageFilter.GaussianBlur(.6))
canvas.paste(chair,(327,945),ca)

# Reuse only clothing below each supplied portrait; no generated head is included.
old=np.array(Image.open(B/'exec-e56f42ff-18f4-4b62-b9d0-78f2ecdbbdc7.png').convert('RGB'))
polys=[[(0,550),(251,550),(261,1170),(238,1390),(205,1400),(180,1290),(102,1270),(89,1350),(44,1350),(0,1290)],
[(828,550),(1085,550),(1085,1250),(1040,1310),(976,1310),(970,1260),(903,1260),(862,1266),(831,1160)],
[(160,490),(427,490),(440,580),(430,790),(376,831),(367,1090),(272,1220),(217,1390),(177,1160)],
[(418,446),(582,446),(602,586),(578,620),(454,586)],
[(608,459),(856,459),(878,662),(866,1010),(827,1243),(777,1250),(709,1120),(691,829),(638,786),(615,756)]]
shape=np.zeros(old.shape[:2],np.uint8)
cv2.fillPoly(shape,[np.array(p,np.int32) for p in polys],255)
mask=np.where(shape>0,cv2.GC_PR_FGD,cv2.GC_BGD).astype(np.uint8)
er=cv2.erode(shape,np.ones((19,19),np.uint8))>0
rgb=old.astype(np.int16)
cloth=(rgb.mean(2)<85)&(rgb[:,:,0]-rgb[:,:,2]<10)
mask[er&cloth]=cv2.GC_FGD
cv2.grabCut(cv2.cvtColor(old,cv2.COLOR_RGB2BGR),mask,None,np.zeros((1,65)),np.zeros((1,65)),5,cv2.GC_INIT_WITH_MASK)
a=Image.fromarray(np.where((mask==1)|(mask==3),255,0).astype('uint8')).filter(ImageFilter.GaussianBlur(.6))
canvas.paste(Image.fromarray(old),(0,0),a)

specs=[('LQF',.327,-51,193),('JS',.329,749,229),('WZH',.371,236,231),('DWD',.375,495,230),('LJT',.390,80,262)]
for name,s,x,y in specs:
    im=Image.open(P/'cutouts'/(name+'.png'))
    im=im.resize((round(im.width*s),round(im.height*s)),Image.Resampling.LANCZOS)
    alpha=im.getchannel('A')
    for yy in range(im.height-35,im.height):
        for xx in range(im.width):
            alpha.putpixel((xx,yy),round(alpha.getpixel((xx,yy))*(im.height-1-yy)/35))
    canvas.paste(im,(x,y),alpha)
d=Image.open(P/'cutouts'/'mentor.png')
s=.64;d=d.resize((round(d.width*s),round(d.height*s)),Image.Resampling.LANCZOS)
canvas.paste(d,(310,553),d)
canvas.crop((43,120,1043,1370)).save(P/'team-clean-composite-v1.png')
# Exact source RGB validation before resampling: the segmentation changes alpha only.
report={}
for name in ['LQF','WZH','JS','DWD','LJT']:
    original=np.array(Image.open(B/(name+'.png')).convert('RGB'))
    result=np.array(Image.open(P/'cutouts'/(name+'.png')))
    report[name]={'rgb_exact':bool(np.array_equal(original,result[:,:,:3]))}
(P/'source-pixel-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(report)
