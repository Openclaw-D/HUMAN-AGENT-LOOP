from PIL import Image, ImageDraw, ImageFilter, ImageChops
from pathlib import Path
from collections import deque

B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
O=Path(__file__).parent
def skin_balance(im, mentor=False, gain=1.0):
    # Photometric correction only: no geometry change or synthesized facial texture.
    r,g,b=im.split()
    red_excess=ImageChops.subtract(r,b)
    mask=red_excess.point(lambda v: min(255,max(0,(v-3)*14)))
    light=im.convert('L').point(lambda v:255 if 65<v<245 else 0)
    mask=ImageChops.multiply(mask,light).filter(ImageFilter.GaussianBlur(2))
    corrected=im.filter(ImageFilter.MedianFilter(3)) if mentor else im
    rr,gg,bb=corrected.split()
    corrected=Image.merge('RGB',(
        rr.point(lambda v:round(min(255,v*gain*(1.014 if mentor else 1)))),
        gg.point(lambda v:round(min(255,v*gain))),
        bb.point(lambda v:round(min(255,v*gain*(.974 if mentor else .995))))))
    return Image.composite(corrected,im,mask)
base=Image.open(B/'exec-9291e2d1-5843-4422-bb61-2149d4b4ddd0.png').convert('RGB').resize((1086,1448))
# Existing clothing below the portraits only; no prior generated face enters the composite.
old=Image.open(B/'exec-e56f42ff-18f4-4b62-b9d0-78f2ecdbbdc7.png').convert('RGB')
lower=Image.new('L',base.size,0)
ld=ImageDraw.Draw(lower)
ld.polygon([(0,550),(251,550),(261,1170),(238,1390),(205,1400),(180,1290),(102,1270),(89,1350),(44,1350),(0,1290)],fill=255)
ld.polygon([(828,550),(1085,550),(1085,1250),(1040,1310),(976,1310),(970,1260),(903,1260),(862,1266),(831,1160)],fill=255)
ld.polygon([(160,490),(427,490),(440,580),(430,790),(376,831),(367,1090),(272,1220),(217,1288),(177,1160)],fill=255)
ld.polygon([(418,446),(582,446),(602,586),(578,620),(454,586)],fill=255)
ld.polygon([(608,459),(856,459),(878,662),(866,1010),(827,1243),(777,1250),(709,1120),(691,829),(638,786),(615,756)],fill=255)
# Keep lower-body supports outside the chair and the seated subject.
for yy in range(446,1448):
    for xx in range(1086):
        if lower.getpixel((xx,yy)):
            if (yy>790 and 250<xx<760) or (yy>1130 and 240<xx<830):
                lower.putpixel((xx,yy),0)
base.paste(old,(0,0),lower.filter(ImageFilter.GaussianBlur(1)))

def cutout(im,name):
    # Background-only flood from image boundaries; never enter the subject interior.
    im=im.convert('RGB')
    w,h=im.size
    p=im.load()
    outlines={
      'LQF':[(400,211),(415,120),(480,59),(571,33),(683,40),(768,81),(818,159),(827,270),(799,381),(810,496),(880,535),(1046,615),(1120,722),(1160,1254),(110,1254),(144,871),(177,750),(232,656),(429,560),(454,523),(425,447),(410,367)],
      'WZH':[(493,243),(495,163),(534,89),(624,57),(720,69),(795,121),(833,202),(832,301),(813,378),(791,437),(851,480),(941,502),(978,558),(998,721),(1010,1254),(175,1254),(181,1126),(230,974),(228,768),(277,604),(404,550),(520,476),(534,444),(510,375)],
      'JS':[(431,310),(438,221),(492,147),(587,111),(690,119),(764,166),(814,241),(824,333),(819,417),(799,488),(775,549),(856,609),(997,647),(1090,723),(1150,952),(1170,1254),(163,1254),(195,939),(223,781),(299,716),(453,663),(498,615),(485,558),(447,475)],
      'DWD':[(459,277),(473,184),(537,116),(625,88),(715,109),(776,163),(800,237),(793,323),(791,390),(765,458),(743,504),(814,551),(931,586),(999,644),(1055,753),(1081,1033),(1102,1254),(220,1254),(227,982),(265,777),(321,660),(440,605),(491,558),(500,516),(476,455),(459,394)],
      'LJT':[(448,325),(464,234),(508,167),(585,128),(666,129),(730,161),(783,228),(811,333),(826,461),(845,557),(977,612),(1049,668),(1052,779),(1086,1018),(1094,1254),(205,1254),(233,970),(243,795),(275,669),(311,631),(438,599),(445,492)]
    }
    alpha=Image.new('L',im.size,0)
    ImageDraw.Draw(alpha).polygon(outlines[name],fill=255)
    # Fill a single exterior silhouette per row to preserve the entire subject interior.
    for yy in range(h):
        xs=[]
        for xx in range(w):
            if not alpha.getpixel((xx,yy)):
                continue
            r,g,b=p[xx,yy]
            if (r+g+b)/3<85 or (r-b>25 and r-g>5):
                xs.append(xx)
        if xs:
            ImageDraw.Draw(alpha).line((0,yy,w-1,yy),fill=0)
            ImageDraw.Draw(alpha).line((min(xs),yy,max(xs),yy),fill=255)
        else:
            ImageDraw.Draw(alpha).line((0,yy,w-1,yy),fill=0)
    return alpha.filter(ImageFilter.GaussianBlur(.65))
    protected=alpha.filter(ImageFilter.MinFilter(31))
    q=deque([(x,0) for x in range(w)]+[(0,y) for y in range(h)]+[(w-1,y) for y in range(h)])
    visited=set()
    while q:
        x,y=q.popleft()
        if not(0<=x<w and 0<=y<h) or (x,y) in visited:
            continue
        visited.add((x,y))
        if w*.42<x<w*.60 and y>h*.25:
            continue
        r,g,b=p[x,y]
        if max(r,g,b)-min(r,g,b)<34 and r-b<25 and 90<(r+g+b)/3<230:
            alpha.putpixel((x,y),0)
            q.extend(((x-1,y),(x+1,y),(x,y-1),(x,y+1)))
    alpha=alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(.6))
    return alpha

# Uniform scaling of each complete portrait; no independent head transformations.
# Depth order keeps nearer original figures in front of farther figures.
specs=[('LQF',.327, -51,193),('JS',.329,749,229),('WZH',.371,236,231),
       ('DWD',.375,495,230),('LJT',.390,80,262)]
for name,s,x,y in specs:
    im=Image.open(B/(name+'.png')).convert('RGB')
    alpha=cutout(im,name)
    im.save(O/(name+'-source-preserved.png'))
    im=skin_balance(im,gain={'LQF':.985,'JS':.985,'WZH':1.0,'DWD':.99,'LJT':.985}[name])
    size=(round(im.width*s),round(im.height*s))
    im=im.resize(size,Image.Resampling.LANCZOS)
    alpha=alpha.resize(size,Image.Resampling.LANCZOS)
    # Blend only the jacket's bottom boundary into the existing lower-body scene.
    fade=45
    for yy in range(size[1]-fade,size[1]):
        a=(size[1]-1-yy)/fade
        for xx in range(size[0]):
            alpha.putpixel((xx,yy),round(alpha.getpixel((xx,yy))*a))
    base.paste(im,(x,y),alpha)

# Mentor: original entire seated person, with a manually traced exterior outline.
d=Image.open(r'C:\Users\22673\Desktop\Anthropic\.codex-remote-attachments\01a07900-7a8c-7c81-af8a-8006f8ab8a9c\5bedc610-92f7-40dc-80ac-95a94c0bc049\1-Photo-1.jpg').convert('RGB')
outline=[(219,180),(229,128),(269,82),(324,58),(381,69),(426,90),(455,132),
 (464,192),(452,253),(447,302),(427,347),(395,377),(386,405),
 (480,440),(534,468),(564,513),(565,590),(578,650),(594,729),(600,817),
 (588,932),(566,1007),(676,1052),(758,1107),(812,1160),(832,1210),(823,1279),
 (259,1279),(196,1227),(169,1150),(169,1075),(188,989),(184,946),
 (146,907),(111,858),(104,801),(109,710),(116,617),(124,551),(112,530),
 (120,504),(151,485),(232,444),(261,426),(277,395),(264,366),(243,338),
 (234,299),(220,262)]
mask=Image.new('L',d.size,0)
ImageDraw.Draw(mask).polygon(outline,fill=255)
dp=d.load()
md=ImageDraw.Draw(mask)
for yy in range(d.height):
    candidates=[]
    for xx in range(d.width):
        if mask.getpixel((xx,yy)):
            r,g,b=dp[xx,yy]
            if (r+g+b)/3<58 or (r-b>3 and r-g>-4):
                candidates.append(xx)
    if candidates:
        md.line((0,yy,d.width-1,yy),fill=0)
        md.line((min(candidates),yy,max(candidates),yy),fill=255)
mask=mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
s=.64
size=(round(d.width*s),round(d.height*s))
d=skin_balance(d,mentor=True,gain=1.0)
d=d.resize(size,Image.Resampling.LANCZOS)
mask=mask.resize(size,Image.Resampling.LANCZOS)
# A soft cast shadow connects the seated silhouette to the chair and nearby space.
shadow=Image.new('L',base.size,0)
shadow.paste(mask,(315,560))
shadow=shadow.filter(ImageFilter.GaussianBlur(12)).point(lambda v:round(v*.22))
base.paste(Image.new('RGB',base.size,(8,8,10)),(0,0),shadow)
base.paste(d,(310,553),mask)
result=base.crop((43,120,1043,1370))
result.save(O/'team-skin-balanced-v1.png')
result.save(O/'team-skin-balanced-v1.jpg',quality=97,subsampling=0)
result.crop((355,465,555,680)).resize((400,430)).save(O/'mentor-skin-review.png')
print(O/'team-skin-balanced-v1.png')
