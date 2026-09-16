from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from collections import deque

BASE = Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
OUT = Path(__file__).parent
canvas = Image.open(BASE / 'exec-e56f42ff-18f4-4b62-b9d0-78f2ecdbbdc7.png').convert('RGB')
# Coordinates use the displayed 1086 x 1448 composition and 1254 square sources.
layers = [
    ('LQF.png', (398, 24, 829, 646), (79, 201, 220, 405)),
    ('WZH.png', (490, 44, 835, 477), (420, 248, 548, 409)),
    ('JS.png', (422, 95, 832, 654), (886, 255, 1022, 441)),
    ('DWD.png', (455, 72, 803, 548), (666, 257, 796, 435)),
    ('LJT.png', (438, 125, 815, 650), (251, 310, 398, 515)),
]
def paste_head(source, box, target, contour=None, trim_sides=False):
    crop = source.crop(box).convert('RGB')
    w, h = target[2]-target[0], target[3]-target[1]
    crop = crop.resize((w,h), Image.Resampling.LANCZOS)
    mask = Image.new('L', (w,h), 0)
    d = ImageDraw.Draw(mask)
    # Feather only the outer silhouette; facial interior remains fully opaque.
    pts = [(0.20*w,0.01*h),(0.78*w,0.01*h),(0.97*w,0.20*h),
           (0.96*w,0.65*h),(0.84*w,0.86*h),(0.64*w,0.99*h),
           (0.37*w,0.99*h),(0.15*w,0.86*h),(0.03*w,0.63*h),(0.03*w,0.22*h)]
    d.polygon(pts, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    # Remove connected neutral studio background without touching face interiors.
    px = crop.load()
    seen = set()
    q = deque([(x,0) for x in range(w)] + [(0,y) for y in range(h)] + [(w-1,y) for y in range(h)])
    while q:
        x,y = q.popleft()
        if (x,y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x,y))
        if ((x/w-0.51)/0.43)**2 + ((y/h-0.61)/0.40)**2 < 1:
            continue
        r,g,b = px[x,y]
        neutral = max(r,g,b)-min(r,g,b) < 29 and 65 < (r+g+b)/3 < 225
        if neutral:
            mask.putpixel((x,y),0)
            q.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
    mask = mask.filter(ImageFilter.GaussianBlur(0.45))
    if trim_sides:
        # Locate the exterior skin silhouette row by row; retain all interior features.
        for y in range(int(h*0.48),int(h*0.94)):
            skin=[]
            for x in range(w):
                r,g,b=px[x,y]
                if r-b>13 and r-g>5 and r>75:
                    skin.append(x)
            if len(skin)>w*0.20:
                lo,hi=min(skin),max(skin)
                for x in range(w):
                    if x<lo or x>hi:
                        mask.putpixel((x,y),0)
        mask=mask.filter(ImageFilter.GaussianBlur(0.55))
    if contour:
        # Hand-traced silhouette avoids classifying screen-photographed skin as background.
        background_mask=mask.copy()
        mask = Image.new('L', (w*4,h*4), 0)
        trace = [((x-box[0])*w*4/(box[2]-box[0]),
                  (y-box[1])*h*4/(box[3]-box[1])) for x,y in contour]
        ImageDraw.Draw(mask).polygon(trace,fill=255)
        mask = mask.resize((w,h),Image.Resampling.LANCZOS)
        mask = mask.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(0.9))
        mask=ImageChops.darker(mask,background_mask)
        # Reduce only fine screen sampling interference, without synthesis.
        crop = crop.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.UnsharpMask(radius=0.7,percent=65,threshold=4))
    # Fade the neck seam, outside the preserved facial features.
    for y in range(int(h*0.90), h):
        a = (h-1-y)/max(1,h*0.10)
        for x in range(w):
            mask.putpixel((x,y), round(mask.getpixel((x,y))*a))
    canvas.paste(crop, target[:2], mask)

for name, box, target in layers:
    paste_head(Image.open(BASE/name), box, target,trim_sides=name!='LJT.png')
director = Image.open(r'C:\Users\22673\Desktop\Anthropic\.codex-remote-attachments\01a07900-7a8c-7c81-af8a-8006f8ab8a9c\5bedc610-92f7-40dc-80ac-95a94c0bc049\1-Photo-1.jpg')
paste_head(director, (212,54,470,420), (448,577,605,800),
           [(223,217),(223,166),(238,118),(269,85),(311,64),(353,63),
            (398,75),(434,100),(453,133),(461,174),(460,220),(450,250),
            (448,289),(436,323),(416,353),(390,378),(373,400),
            (365,419),(305,419),(296,392),(272,371),(252,342),
            (242,311),(230,293),(228,266),(234,250)])
canvas.save(OUT/'team-reconstructed-v6.png')
canvas.save(OUT/'team-reconstructed-v6.jpg',quality=97,subsampling=0)
# Review faces at output scale as well as enlarged, without modifying deliverable.
regions=[(60,185,230,430),(246,300,397,490),(405,236,560,432),
         (650,246,812,457),(874,245,1033,462),(437,568,616,818)]
sheet=Image.new('RGB',(900,600),'#303030')
for i,region in enumerate(regions):
    tile=canvas.crop(region)
    tile.thumbnail((280,280))
    sheet.paste(tile,((i%3)*300+(300-tile.width)//2,(i//3)*300))
sheet.save(OUT/'face-review-v6.png')
print(OUT/'team-reconstructed-v6.png')
