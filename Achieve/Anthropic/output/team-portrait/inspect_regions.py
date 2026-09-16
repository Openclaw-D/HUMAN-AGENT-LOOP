from PIL import Image,ImageDraw
from pathlib import Path
B=Path(r'C:\Users\22673\.codex\generated_images\01a07900-7a8c-7c81-af8a-8006f8ab8a9c')
O=Path(__file__).parent
for n in ['LJT','JS','DWD']:
    im=Image.open(B/(n+'.png')).crop((350,300,900,800))
    d=ImageDraw.Draw(im)
    for y in range(350,800,50):
        d.line((0,y-300,550,y-300),fill='red',width=1)
        d.text((0,y-300),str(y),fill='white')
    im.save(O/(n+'-coordinate-review.png'))
im=Image.open(B/'exec-e56f42ff-18f4-4b62-b9d0-78f2ecdbbdc7.png').crop((240,300,420,550)).resize((540,750))
d=ImageDraw.Draw(im)
for y in range(300,550,20):
    d.line((0,(y-300)*3,540,(y-300)*3),fill='red')
    d.text((0,(y-300)*3),str(y),fill='white')
im.save(O/'LJT-target-review.png')
