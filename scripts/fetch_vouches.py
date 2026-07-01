import urllib.request, ssl, json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

base = 'https://api.github.com/repos/Sakuras-Hub/Sakuras-Hub/contents/need%20for%20the%20website%20to%20work'
req = urllib.request.Request(base, headers={'User-Agent': 'opencode', 'Accept': 'application/json'})
resp = urllib.request.urlopen(req, timeout=30, context=ctx)
files = json.loads(resp.read().decode('utf-8'))
for f in files:
    print(f'{f["name"]:40s} {f["type"]:10s} {f.get("size",0):>8d}')
