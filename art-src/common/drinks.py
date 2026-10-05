"""Shared drinks and food props (about 14 px, centred in a 32x32 cell)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('prop.coffee', note='cup of coffee on a saucer, with latte art')
def coffee(pal, seed):
    c = new(pal, seed)
    c.ellipse(15.5, 22, 10, 4, 'cupC'); c.ellipse(15.5, 21.5, 9, 3, 'mugW')
    c.rect(9, 12, 22, 21, 'mugW'); c.vline(9, 12, 21, 'white'); c.vline(22, 12, 21, 'paperD'); c.hline(9, 22, 21, 'paperD')
    c.ellipse(15.5, 12, 7, 3, 'mugW'); c.ellipse(15.5, 12, 5.5, 2.2, 'coffee'); c.put(15, 12, 'cream'); c.put(14, 11, 'cream'); c.put(16, 11, 'cream'); c.put(15, 13, 'cream')
    c.rect(23, 14, 25, 18, 'mugW'); c.rect(24, 15, 24, 17, None); c.vline(25, 14, 18, 'paperD')
    for x, y in ((13, 7), (15, 5), (17, 7), (14, 4)):
        c.put(x, y, 'white')
    c.outline(); return c


@sprite('prop.matcha', note='matcha bowl with whisk')
def matcha(pal, seed):
    c = new(pal, seed)
    c.ellipse(15.5, 17, 11, 7, 'cupC'); c.ellipse(15.5, 15, 11, 6, 'mugW')
    c.ellipse(15.5, 14, 9, 4, 'matchaD'); c.ellipse(15.5, 13.5, 8, 3.2, 'matcha'); c.put(13, 13, 'greenL'); c.put(17, 13, 'greenL'); c.put(15, 12, 'greenL')
    c.rect(11, 22, 20, 24, 'cupC'); c.hline(11, 20, 24, 'paperD')
    c.line(25, 20, 28, 12, 'cwood3'); c.rect(26, 8, 29, 12, 'cwood4'); c.vline(27, 8, 12, 'cwood2')
    c.outline(); return c


@sprite('prop.icedCoffee', note='tall iced coffee with straw')
def iced(pal, seed):
    c = new(pal, seed)
    c.rect(10, 8, 21, 25, 'ice'); c.vline(10, 8, 25, 'white'); c.vline(21, 8, 25, 'iceD'); c.hline(11, 20, 25, 'iceD')
    c.rect(11, 12, 20, 24, 'coffeeL'); c.rect(11, 18, 20, 24, 'coffee'); c.dither_band(11, 16, 20, 17, 'coffeeL', 'coffee')
    c.rect(12, 13, 14, 15, 'ice'); c.rect(16, 15, 18, 17, 'ice'); c.rect(13, 19, 15, 21, 'ice'); c.put(12, 13, 'white')
    c.line(17, 2, 15, 12, 'red'); c.line(18, 2, 16, 12, 'white')
    c.outline(); c.ground_shadow(9, 22, 27) if False else None
    return c


@sprite('prop.juice', note='fresh orange juice with orange slice')
def juice(pal, seed):
    c = new(pal, seed)
    c.rect(10, 10, 21, 25, 'ice'); c.vline(10, 10, 25, 'white'); c.vline(21, 10, 25, 'iceD'); c.hline(11, 20, 25, 'iceD')
    c.rect(11, 12, 20, 24, 'juiceO'); c.rect(11, 20, 20, 24, 'juiceOD'); c.hline(11, 20, 12, 'juiceOL'); c.vline(12, 13, 22, 'juiceOL')
    c.ellipse(22, 10, 5, 5, 'juiceOD'); c.ellipse(22, 10, 4, 4, 'juiceO'); c.ellipse(22, 10, 1.4, 1.4, 'juiceOL')
    for a in range(0, 360, 60):
        import math
        c.put(int(22 + math.cos(math.radians(a)) * 3), int(10 + math.sin(math.radians(a)) * 3), 'juiceOL')
    c.outline(); return c


@sprite('prop.dates', note='bowl of dates')
def dates(pal, seed):
    c = new(pal, seed)
    c.ellipse(15.5, 22, 12, 6, 'terra' if False else 'cwood1'); c.ellipse(15.5, 19, 12, 6, 'cwood2'); c.ellipse(15.5, 18, 10, 4.5, 'dateB')
    for x, y in ((11, 15), (15, 14), (19, 15), (13, 17), (17, 17), (21, 17), (9, 17), (15, 11), (12, 12), (19, 12)):
        c.rect(x, y, x + 3, y + 2, 'dateB'); c.put(x, y, 'dateL'); c.put(x + 1, y, 'dateL')
    c.outline(); return c


@sprite('prop.herbalTea', note='glass cup of herbal tea with tea bag')
def herbal(pal, seed):
    c = new(pal, seed)
    c.ellipse(15.5, 23, 10, 4, 'cupC'); c.ellipse(15.5, 22.5, 9, 3, 'mugW')
    c.rect(9, 11, 22, 22, 'ice'); c.vline(9, 11, 22, 'white'); c.vline(22, 11, 22, 'iceD')
    c.rect(10, 13, 21, 21, 'teaC'); c.rect(10, 18, 21, 21, 'teaCD'); c.hline(10, 21, 13, 'juiceOL')
    c.rect(24, 14, 25, 19, 'ice'); c.rect(24, 15, 24, 18, None)
    c.line(13, 6, 15, 14, 'white'); c.rect(14, 5, 17, 8, 'paper'); c.put(15, 6, 'greenL')
    c.line(16, 8, 15, 14, 'paperD')
    for x, y in ((19, 8), (20, 6)):
        c.put(x, y, 'white')
    c.outline(); return c
