"""Reemplaza únicamente la identidad gráfica de ToolControl iPhone V2.4.
Idempotente; no modifica lógica de inventario, QR, SMS, cuentas ni Supabase.
"""
from __future__ import annotations
import base64, io, json, re
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
data=base64.b64decode((ROOT/"branding/toolcontrol-logo-480.avif.base64").read_text().strip(),validate=True)
image=Image.open(io.BytesIO(data)).convert("RGB")
assert image.size==(480,320),f"Dimensiones inesperadas {image.size}"
image.save(ROOT/"toolcontrol-logo.png",format="PNG",optimize=True)
# Icono comercial cuadrado: caja QR central, herramientas, fondo azul oscuro.
icon=Image.new("RGB",(512,512),"#061b35")
crop=image.crop((70,0,410,320))
crop=ImageOps.contain(crop,(500,500),Image.Resampling.LANCZOS)
icon.paste(crop,((512-crop.width)//2,(512-crop.height)//2))
icon.save(ROOT/"toolcontrol-app-icon.png",format="PNG",optimize=True)
# El antiguo SVG tampoco debe seguir mostrando martillo y llave anteriores.
png=base64.b64encode((ROOT/"toolcontrol-app-icon.png").read_bytes()).decode()
(ROOT/"icon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
    '<image x="0" y="0" width="512" height="512" href="data:image/png;base64,'+png+'"/></svg>',
    encoding="utf-8")
manifest_path=ROOT/"manifest.webmanifest"
manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["icons"]=[
    {"src":"toolcontrol-app-icon.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}
]
manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
html_path=ROOT/"index.html"
html=html_path.read_text(encoding="utf-8")
# Sustituir marcas gráficas originales estáticas, no imágenes de herramientas.
html,nimg=re.subn(
    r'(src=["\x27])data:image/(?:png|webp|jpeg|jpg);base64,[a-zA-Z0-9+/=]+',
    r'\1./toolcontrol-logo.png',html)
html,nbackground=re.subn(
    r'url\((["\x27]?)data:image/(?:png|webp|jpeg|jpg);base64,[a-zA-Z0-9+/=]+\1\)',
    'url("./toolcontrol-logo.png")',html)
# Los iconos estáticos previos se sustituyen sin tocar otros recursos.
html=html.replace('href="./icon.svg"','href="./toolcontrol-app-icon.png"')
html=html.replace('href="icon.svg"','href="toolcontrol-app-icon.png"')
html=re.sub(r'alt="[^"]*(?:UNEXPO|Gaylor)[^"]*"','alt="ToolControl"',html,flags=re.I)
# Nueva regla CSS al final de <head>, para no romper las otras hojas de estilo.
style='<style id="tc-branding-commercial-v24">\n' \
    '.brand-attribution{background:linear-gradient(145deg,#07172c,#08294e)!important;}\n' \
    '.brand-attribution .identity-logo{width:100%;max-height:none;object-fit:contain;}\n' \
    '.brand-attribution .credit,.splash-credit,.about-credit{display:none!important;}\n' \
    '.brand-logo{background:#09244a url("./toolcontrol-app-icon.png") center/cover no-repeat!important;color:transparent!important;}\n' \
    '#tcSplash{background:linear-gradient(#05192ba6,#05192bd7),url("./toolcontrol-logo.png") center/contain no-repeat,#061a31!important;}\n' \
    '.top{background:linear-gradient(130deg,#07182d,#0b3154)!important;}\n' \
    '.about-cover{background:linear-gradient(#06182aba,#051b35ef),url("./toolcontrol-logo.png") center/contain no-repeat!important;}\n' \
    '</style>\n'
if 'id="tc-branding-commercial-v24"' not in html:
    assert '</head>' in html, "HTML sin head"
    html=html.replace('</head>',style+'</head>',1)
assert nimg>=1, "No se localizaron los logotipos incrustados de iPhone"
assert (nbackground+nimg)>=2, "No se localizaron imágenes de presentación adicionales"
html_path.write_text(html,encoding="utf-8")
sw_path=ROOT/"sw.js"
sw=sw_path.read_text(encoding="utf-8")
sw,ncache=re.subn(r"const CACHE='toolcontrol-iphone-[^']+';",
                 "const CACHE='toolcontrol-iphone-v24-nuevo-logo-comercial-v4';",sw,count=1)
assert ncache==1
for asset in ["./toolcontrol-logo.png","./toolcontrol-app-icon.png"]:
    if "'"+asset+"'" not in sw:
        assert "const SHELL=[" in sw
        sw=sw.replace("const SHELL=[","const SHELL=['"+asset+"',",1)
sw_path.write_text(sw,encoding="utf-8")
assert "tc-iphone-home-android-v24.js" in html
assert "tc-iphone-scanner-frame-v24.js" in html
assert "tc-iphone-inventory-v24.js" in html
print(f"Marca iPhone comercial: logo={image.size}, fotos estaticas={nimg}, fondos={nbackground}, PWA icono actualizado")
