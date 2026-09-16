from pathlib import Path
import sys, ast
sys.path.insert(0,r'C:\Users\22673\AppData\Local\uv\cache\archive-v0\4DlIoc7cifau5IH2')
import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

P=Path(__file__).parent
dest=P/'refined-cutouts'; dest.mkdir(exist_ok=True)
tree=ast.parse((P/'whole_people.py').read_text(encoding='utf-8'))
outline=next(ast.literal_eval(n.value) for n in ast.walk(tree) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='outline' for t in n.targets))
face_boxes={'LQF':(465,200,750,520),'JS':(490,300,775,575),'WZH':(550,255,779,451),'DWD':(490,265,765,509),'LJT':(521,241,758,494),'mentor':(285,200,428,367)}
for name in ['LQF','JS','WZH','DWD','LJT','mentor']:
    im=Image.open(P/'cutouts'/(name+'.png')).convert('RGBA')
    a=im.getchannel('A')
    rgb=np.array(im.convert('RGB'))
    if name=='mentor':
        # A traced exterior limits segmentation overshoot onto the original screen.
        limit=Image.new('L',im.size)
        ImageDraw.Draw(limit).polygon(outline,fill=255)
        limit=limit.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(.6))
        ImageDraw.Draw(limit).rectangle((0,0,im.width,1120),fill=255)
        alpha=np.minimum(np.array(a),np.array(limit))
        alpha[655:697,544:578]=255
        alpha=cv2.erode(alpha,np.ones((3,3),np.uint8))
        inside=(alpha>128).astype(np.uint8)
        sdf=cv2.distanceTransform(inside,cv2.DIST_L2,5)-cv2.distanceTransform(1-inside,cv2.DIST_L2,5)
        sdf=cv2.GaussianBlur(sdf,(0,0),1.6)
        a=Image.fromarray(np.clip((sdf+.6)*212.5,0,255).astype(np.uint8))
        # Screen cursor and arm-only watermark repair: no face inpainting.
        repair=np.zeros(rgb.shape[:2],np.uint8)
        cv2.fillPoly(repair,[np.array([(107,843),(167,809),(178,837),(116,873)])],255)
        rgb=cv2.inpaint(rgb,repair,7,cv2.INPAINT_TELEA)
        # The cursor straddles fabric and skin; interpolate vertically within each column.
        cursor=np.zeros(rgb.shape[:2],np.uint8)
        cv2.circle(cursor,(560,675),17,255,-1)
        rgb=cv2.inpaint(rgb,cursor,5,cv2.INPAINT_NS)
        # Optical low-pass removes the photographed display grid before downsampling.
        low=cv2.GaussianBlur(rgb,(5,5),.85)
        low=cv2.bilateralFilter(low,5,13,2)
        rgb=low.astype(np.float32)
        broad=cv2.GaussianBlur(rgb,(0,0),2.4)
        rgb=np.clip(rgb+.22*(rgb-broad),0,255)
        # Pointwise tonal correction only: preserve facial geometry and expression.
        rgb=(rgb-18)*1.10+12
        rgb*=np.array([1.018,1.0,.967],np.float32)
    else:
        rgb=rgb.astype(np.float32)*np.array([.997,.990,.973],np.float32)
    alpha=np.array(a)
    x1,y1,x2,y2=face_boxes[name]
    face_a=alpha[y1:y2,x1:x2]
    foreground=(face_a>=250).astype(np.uint8)
    flood=np.pad(foreground,1)
    cv2.floodFill(flood,None,(0,0),2)
    face_a[flood[1:-1,1:-1]==0]=255
    out=Image.fromarray(np.dstack([np.clip(rgb,0,255).astype(np.uint8),alpha]))
    out.save(dest/(name+'.png'))
    if name=='mentor':
        check=Image.new('RGB',im.size,(59,52,44)); check.paste(out,(0,0),out)
        check.save(P/'mentor-edge-review.png')
print(dest)
