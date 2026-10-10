"""Pet props: the office cat's water bowl (floor tile, furniture layer)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'art'))
from registry import sprite, new


@sprite('waterBowl', note='steel pet bowl full of water, sits on the floor')
def water_bowl(pal, seed):
    c = new(pal, seed)
    c.ellipse(15.5, 24, 10, 4, 'silverD')           # rim
    c.ellipse(15.5, 23.5, 9, 3.2, 'silver')
    c.ellipse(15.5, 23, 7.5, 2.4, 'blue')           # water
    c.ellipse(15.5, 22.5, 5, 1.4, 'blueL')
    c.put(12, 22, 'white'); c.put(13, 22, 'white'); c.put(19, 23, 'white')
    c.rect(11, 26, 20, 27, 'silverD')               # foot
    c.outline(); c.ground_shadow(9, 22, 28)
    return c
