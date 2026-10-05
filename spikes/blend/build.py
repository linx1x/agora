"""Builds the spike pages from page.html + blend.js + app.js.

  python spikes/blend/build.py              -> index.html (open via a static server at the repo root)
  python spikes/blend/build.py <asset dir>  -> also artifact.html, self-contained (jungle/common png+json
                                               and palettes.json copied into <asset dir>)
"""
import base64, json, pathlib, sys
here = pathlib.Path(__file__).parent
page = (here / 'page.html').read_text(encoding='utf-8')
title_end = page.index('</title>') + len('</title>')
head, body = page[:title_end], page[title_end:]
local = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
         '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
         + head + body.split('<div class="wrap">')[0] + '</head>\n<body>\n<div class="wrap">'
         + body.split('<div class="wrap">', 1)[1]
         + '\n<script src="blend.js"></script>\n<script src="app.js"></script>\n</body>\n</html>\n')
(here / 'index.html').write_text(local, encoding='utf-8')
if len(sys.argv) > 1:
    a = pathlib.Path(sys.argv[1])  # folder holding jungle/common png+json and palettes.json
    d = lambda p: 'data:image/png;base64,' + base64.b64encode((a / p).read_bytes()).decode()
    pal = json.loads((a / 'palettes.json').read_text())
    assets = {'jungle': d('jungle.png'), 'common': d('common.png'),
              'jungleJson': json.loads((a / 'jungle.json').read_text()),
              'commonJson': json.loads((a / 'common.json').read_text()),
              'palettes': {'common': pal['common'], 'jungle': pal['jungle']}}
    js = lambda f: (here / f).read_text(encoding='utf-8').replace('</script', '<\\/script')
    art = (page + '\n<script>window.BLEND_ASSETS=' + json.dumps(assets) + ';</script>\n<script>\n'
           + js('blend.js') + '\n</script>\n<script>\n' + js('app.js') + '\n</script>\n')
    (here / 'artifact.html').write_text(art, encoding='utf-8')
