/**
 * Which tiles make an interest spot, for the office cat (`petSpots`, P14.4, ADR-041) and the
 * characters (`npcSpots`, P15.2–P15.3, ADR-044). One table so a new tile type is taught to both:
 * spots come from tile names alone, so a map people built works as well as the generated one.
 */

/** Wall tiles with a view: a cat loafs under them, a character takes a break looking out. */
export const WINDOW_WALL = /^window$/;
/** Potted plants: a character stops by one for a short break. */
export const PLANT = /^plant[ABC]$/;
/** The kitchen corner: coffee for characters. */
export const COFFEE = /^(counter|fridge|waterCooler)$/;
/** Water a cat drinks from (side banks only). */
export const POND = /^(water|pond\d+)$/;
/** Water a character walks along: ponds, falls, fountains and the Zen basin. */
export const WATER_EDGE = /^(pond\d*|water|fall\d+|tsukubai)$/;
/** Sofas, where a cat sleeps on the seat. */
export const SOFA = /^sofa[LMR]?$/;
