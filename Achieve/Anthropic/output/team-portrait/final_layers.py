from pathlib import Path
from PIL import Image,ImageFilter
import io,json,zipfile,xml.etree.ElementTree as ET
import numpy as np
P=Path(__file__).parent; B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
W,H=1000,1250
scene=Image.open(B/'exec-36edec1f-e662-4c9e-a82d-b61a62df2ece.png').convert('RGBA').resize((W,H),Image.Resampling.LANCZOS)
layers=[('Room, chair and lower clothing - repaired',scene,0,0)]
specs=[('LQF',.327,-51,193),('JS',.329,749,229),('WZH',.371,236,231),('DWD',.375,495,230),('LJT',.390,80,262),('mentor',.64,310,553)]
for name,s,x,y in specs:
    im=Image.open(P/'refined-cutouts'/(name+'.png')).convert('RGBA')
    size=(round(im.width*s),round(im.height*s))
    im=im.resize(size,Image.Resampling.LANCZOS)
    a=im.getchannel('A')
    if name!='mentor':
        # Only the lower jacket seam is softened; faces remain opaque source pixels.
        for yy in range(im.height-45,im.height):
            f=(im.height-1-yy)/45
            for xx in range(im.width):
                a.putpixel((xx,yy),round(a.getpixel((xx,yy))*f))
    im.putalpha(a)
    layers.append((name+' - source portrait, tonal correction, no facial warp',im,x-43,y-120))
result=Image.new('RGBA',(W,H))
for name,im,x,y in layers:
    result.alpha_composite(im,(x,y))
face_boxes={'LQF':(465,200,750,520),'JS':(490,300,775,575),'WZH':(550,255,779,451),'DWD':(490,265,765,509),'LJT':(521,241,758,494),'mentor':(285,200,428,367)}
checks=[]
proof=Image.new('RGB',(900,440),(60,60,60))
for (name,s,_,_),(label,im,x,y) in zip(specs,layers[1:]):
    box=tuple(round(v*s) for v in face_boxes[name])
    crop=im.crop(box)
    actual=result.crop((x+box[0],y+box[1],x+box[2],y+box[3]))
    delta=np.abs(np.asarray(crop.convert('RGB')).astype(int)-np.asarray(actual.convert('RGB')).astype(int))
    opaque=np.array(crop.getchannel('A'))==255
    checks.append({'person':name,'opaque_face_pixels_verified':int(opaque.sum()),'max_RGB_delta_from_prepared_source_layer_on_opaque_face':int(delta[opaque].max()),'geometry':'uniform source scaling only','note':'Bounding rectangle includes silhouette exterior. Only opaque source face pixels are compared.'})
    xx=(len(checks)-1)*150
    proof.paste(crop.convert('RGB').resize((150,150)),(xx,0))
    proof.paste(crop.getchannel('A').resize((150,150)),(xx,150))
    proof.paste(actual.convert('RGB').resize((150,140)),(xx,300))
(P/'face-layer-proof.png').parent.mkdir(exist_ok=True)
proof.save(P/'face-layer-proof.png')
(P/'face-layer-verification.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
result.convert('RGB').save(P/'team-retouched-v2.png')
result.convert('RGB').save(P/'team-retouched-v2.jpg',quality=97,subsampling=0)
def pngbytes(im):
    stream=io.BytesIO(); im.save(stream,format='PNG'); return stream.getvalue()
root=ET.Element('image',w=str(W),h=str(H),name='Team portrait - protected original people',version='0.0.3')
stack=ET.SubElement(root,'stack')
with zipfile.ZipFile(P/'team-retouched-v2.ora','w') as z:
    z.writestr('mimetype','image/openraster',compress_type=zipfile.ZIP_STORED)
    for i,(name,im,x,y) in enumerate(reversed(layers)):
        src=f'data/layer{i}.png';z.writestr(src,pngbytes(im))
        ET.SubElement(stack,'layer',name=name,src=src,x=str(x),y=str(y),opacity='1.0',visibility='visible',**{'composite-op':'svg:src-over'})
    z.writestr('stack.xml',ET.tostring(root,encoding='utf-8'))
    z.writestr('mergedimage.png',pngbytes(result))
    thumb=result.copy();thumb.thumbnail((256,256));z.writestr('Thumbnails/thumbnail.png',pngbytes(thumb))
print(P/'team-retouched-v2.ora')
