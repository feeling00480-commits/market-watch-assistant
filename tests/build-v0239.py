"""Rebuild the six-file portable preview: python3 tests/build-v0239.py [v0239]."""
from pathlib import Path
import re,hashlib,base64,zipfile,subprocess,json,sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'v0239')
order=['providers.js','technical.js','appearance.js','research.js','profile.js','futures-analysis.js','futures-ticks.js','market-modes.js','futures-positions.js','market-alerts.js','taiwan-fund-market.js','settings-data.js','settings-ui.js','outlook.js','client.js']
script='\n'+'\n\n'.join((root/name).read_text().strip() for name in order)+'\n'
hash64=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
shell=(root/'app-shell.html').read_text()
csp=f'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-{hash64}\'; style-src \'unsafe-inline\'; connect-src \'self\'; img-src data: \'self\'; base-uri \'none\'; form-action \'none\'">'
page=shell.replace('<title>',csp+'<title>',1)+'\n<script>'+script+'</script></body></html>'
(root/'app.html').write_text(page)
Path('/tmp/cas-v0239-script.js').write_text(script)
subprocess.run(['node','--check','/tmp/cas-v0239-script.js'],check=True)
launcher=(root/'Start-One-Click.cmd').read_text()
for name in ['Start-Server.ps1','app.html','Update-Manager.ps1']:
 launcher,n=re.subn("'"+re.escape(name)+"'='[0-9A-F]{64}'",f"'{name}'='{hashlib.sha256((root/name).read_bytes()).hexdigest().upper()}'",launcher)
 assert n==1,name
(root/'Start-One-Click.cmd').write_text(launcher,newline='\r\n')
files=['Start-One-Click.cmd','Start-Market-Watch.cmd','Start-Server.ps1','Update-Manager.ps1','app.html','README.txt']
Path('releases').mkdir(exist_ok=True);Path('publish-v0239').mkdir(exist_ok=True)
zip_path=Path('releases/Market_Watch_Assistant_Windows_v0.2.39.zip')
with zipfile.ZipFile(zip_path,'w') as archive:
 for name in files:
  info=zipfile.ZipInfo('Market_Watch_Assistant_Windows_v0.2.39/'+name,date_time=(2026,11,16,0,0,0));info.external_attr=0o100644<<16
  archive.writestr(info,(root/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
manifest={'product':'Market_Watch_Assistant_Windows','schemaVersion':1,'version':'0.2.39','package':zip_path.name,'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest(),'files':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in files}}
Path('publish-v0239/update.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(zip_path) as archive:assert archive.testzip() is None and len(archive.namelist())==6
assert len(launcher.splitlines()[4])<8191
print('Built',zip_path.resolve(),zip_path.stat().st_size)
print('SHA-256',manifest['sha256'])
