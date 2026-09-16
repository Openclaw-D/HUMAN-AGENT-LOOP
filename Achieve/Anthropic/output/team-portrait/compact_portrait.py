from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import importlib.util

P=Path(__file__).parent
# Reuse the existing source-only silhouette function without running its composition.
source=(P/'whole_people.py').read_text(encoding='utf-8')
start=source.index('def cutout(')
end=source.index('# Uniform scaling')
ns={'Image':Image,'ImageDraw':ImageDraw,'ImageFilter':ImageFilter}
exec(source[start:end],ns)
cutout=ns['cutout']
B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
W,H=1100,1375
room=Image.open(B/'exec-9291e2d1-5843-4422-bb61-2149d4b4ddd0.png').convert('RGB')
# Only the empty wall is used; there is no generated human body in this image.
canvas=room.crop((0,0,1086,780)).resize((W,H),Image.Resampling.LANCZOS)
canvas=ImageEnhance.Color(canvas).enhance(.35)
canvas=ImageEnhance.Brightness(canvas).enhance(.72)
specs=[('LQF',.62,-190,40),('JS',.62,536,54),('WZH',.62,160,28),
       ('LJT',.67,-123,356),('DWD',.67,350,350)]
for name,s,x,y in specs:
    im=Image.open(B/(name+'.png')).convert('RGB')
    mask=cutout(im,name)
    # Preserve natural gaps at the outside of the original jacket silhouette.
    mask=mask.filter(ImageFilter.MinFilter(3))
    size=(round(im.width*s),round(im.height*s))
    im=im.resize(size,Image.Resampling.LANCZOS)
    mask=mask.resize(size,Image.Resampling.LANCZOS)
    canvas.paste(im,(x,y),mask)

d=Image.open(r'C:\Users\22673\Desktop\Anthropic\.codex-remote-attachments\01a07900-7a8c-7c81-af8a-8006f8ab8a9c\5bedc610-92f7-40dc-80ac-95a94c0bc049\1-Photo-1.jpg').convert('RGB')
# Upper-body crop uses the intact mentor photo, including its original neck and dress.
contour=[(219,180),(229,128),(269,82),(324,58),(381,69),(426,90),(455,132),
 (464,192),(452,253),(447,302),(427,347),(395,377),(386,405),
 (480,440),(534,468),(564,513),(565,590),(578,650),(594,729),(600,817),
 (588,932),(566,1007),(676,1052),(758,1107),(812,1160),(832,1210),(823,1279),
 (259,1279),(196,1227),(169,1150),(169,1075),(188,989),(184,946),
 (146,907),(111,858),(104,801),(109,710),(116,617),(124,551),(112,530),
 (120,504),(151,485),(232,444),(261,426),(277,395),(264,366),(243,338),(234,299),(220,262)]
mask=Image.new('L',d.size,0)
ImageDraw.Draw(mask).polygon(contour,fill=255)
p=d.load()
for yy in range(d.height):
    xxlist=[]
    for xx in range(d.width):
        if mask.getpixel((xx,yy)):
            r,g,b=p[xx,yy]
            if (r+g+b)/3<58 or (r-b>3 and r-g>-4):
                xxlist.append(xx)
    if xxlist:
        ImageDraw.Draw(mask).line((0,yy,d.width-1,yy),fill=0)
        ImageDraw.Draw(mask).line((min(xxlist),yy,max(xxlist),yy),fill=255)
mask=mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.8))
# Source geometry stays intact. Mild sampling cleanup is applied before downscaling.
d=d.filter(ImageFilter.MedianFilter(3))
s=.86
size=(round(d.width*s),round(d.height*s))
canvas.paste(d.resize(size,Image.Resampling.LANCZOS),(254,720),mask.resize(size,Image.Resampling.LANCZOS))
canvas.save(P/'compact-original-people-v1.png')
print(P/'compact-original-people-v1.png')
