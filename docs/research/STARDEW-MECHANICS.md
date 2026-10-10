# Stardew Valley mechanics for Agora worlds (P17.16)

Status: research note for stream C. Clean room: rules and numbers only. No decompiled code, data
tables, item names, dialogue or art are copied; formulas are written as math and all names are ours.

## Method and limits

- Source: Vincent's own copy, staged read-only. Nothing was copied into the repo.
- Member inventory: REA `inspect-managed-members` (provider `rea-dotnet-static`) on the game DLL and the
  GameData DLL. REA `decompile` and `function` need a native provider (Ghidra, Hopper or IDA), none of
  which is installed, so they were not used.
- IL: a small CIL decoder reads method bodies from the file. It was checked against the IL SHA-256 that
  REA reports on a sample of methods (all matched); the rest use the same code path.
- Not decoded: `Content/Data/*.xnb` (header flag 0x80 = LZX-compressed; no decoder here). Crop days,
  machine times, recipe lists, fish tables and animal intervals are therefore taken from the wiki and
  marked "wiki". We do not use those values; we set our own.
- Cross-check: Stardew Valley Wiki (https://stardewvalleywiki.com/). Code wins on conflicts (section 17).

Evidence keys: `IL Class.Method @offset` (CIL byte offset), `WIKI <page>`, `partial` = the mapping is
not fully resolved and needs a game check at checkpoint L or M.

## 1. Clock and time scale

Rule: a game day runs from 06:00 to 02:00 the next day: 20 game hours, or 1200 game minutes. Game time
moves one game minute every 700 ms of real time at normal speed, so a day lasts 14 real minutes. Time is
written as HHMM on a 24+ hour clock (2600 = 02:00 the next day, 2410 = 00:10). The night-tint thresholds
(1800, 1700 or 1500 by season) are cosmetic.

Evidence: IL `Game1..cctor @0-18` (700 ms per game minute; ten minutes = 7000 ms); IL `Game1.UpdateGameClock`;
WIKI Energy (the bedtime table uses the same clock).

For Agora: `WORLD_DAY_MS = 20 min` for 20 game hours means 1 game minute = 1000 ms (a ten-minute step = 10 s).
Keep 06:00 as the day start and 02:00 as the late limit. Express every rule in game minutes, so changing
`WORLD_DAY_MS` for dev speed does not change any rule. The day is 20 real minutes instead of 14, so
per-action costs stay per action (not per time) and the daily action budget grows with the day length.
Check the pace at checkpoint M.

## 2. Day and season rollover (order of operations)

Rule: at 06:00 the game runs one fixed sequence. The order matters because the sprinkler step (section 7)
comes after growth.

1. Each farmer's day update: energy set to max, bedtime penalty applied (section 9), friendship daily decay
   and gift counters reset (section 13), tool and house upgrade timers ticked.
2. Shipping bin: each item is sold at its sell price (section 15) and the money is credited.
3. Season change (first day of a season): season rules apply to crops and fertilizer (section 3).
4. Weather for the new day.
5. Per location, in this order: animals (`FarmAnimal.dayUpdate`), debris, terrain features
   (`TerrainFeature.dayUpdate`, which runs `HoeDirt.dayUpdate` and then `Crop.newDay`), objects
   (`Object.DayUpdate`: machines progress overnight, sprinklers queue their watering).
6. NPC day update per villager (schedules, dialogue flags).
7. Random farm event, then the post-farm-event actions: queued sprinkler watering runs here, after growth.
8. End-of-night screen.

Evidence: IL `<_newDayAfterFade>d__784.MoveNext` (call order), `Farmer.dayupdate`, `GameLocation.DayUpdate`,
`Farm.DayUpdate`, `Object.DayUpdate @0-100`, `Game1.handlePostFarmEventActions` (runs each location's queued
actions, then clears them).

For Agora: keep this order in `simulateDays`, with the sprinkler step moved as in section 7. The rollover is
discrete per day, so offline catch-up needs day-level state plus machine timers in minutes.

## 3. Crops: growth, withering, regrowth

Rule:
- A crop has a list of phase lengths in days. On each night the crop grows, its day counter in the current
  phase goes up; when it reaches the phase length the crop moves to the next phase. Fully grown when the
  last phase is complete.
- A crop that needs water (data flag, default true) does not grow on a night when its soil is not watered
  (section 4). It stays alive and does not die.
- Growth counts nights, not the planting day. Planting after midnight has no penalty (WIKI Crops).
- Season change: a living outdoor crop that is out of season at the change is killed (it becomes a dead
  crop that stays until cleared). Fully grown crops out of season die too. Multi-season crops keep growing.
  Greenhouse soil ignores seasons (IL `HoeDirt.seasonUpdate @1-20`).
- At the same change the fertilizer on an out-of-season crop is cleared (IL `HoeDirt.seasonUpdate @59`).
- Regrowth: a crop with a regrow time resets to its regrow phase after harvest instead of being removed
  (IL `Crop.ResetPhaseDays`, `Crop.RegrowsAfterHarvest`; WIKI: regrow in 2 days for one crop, 3 for another).

Evidence: IL `Crop.newDay @0-1016` (kill check at 49-57; phase advance at 107-430), `Crop.ResetPhaseDays`,
`Crop.harvest` (regrow branch), `HoeDirt.seasonUpdate`.

For Agora: keep daily growth, the watering gate, out-of-season death at the change, and regrowth. Data per
crop: `seasons[]`, `phaseDays[]` (sum at most 28 for one season, as the brief's test says), `regrowDays?`,
`needsWatering` (default true), `harvest {item, min, max, maxPerFarmingLevel, extraChance}`, `seed`. Dead
crops stay until a tool clears them.

## 4. Soil water

Rule:
- Watering sets the tile to watered.
- At the day end the tile is reset to dry, unless a retention roll succeeds. The retention chance comes from
  the fertilizer on the tile: none 0, tier 1 0.33, tier 2 0.66, tier 3 1.0. Greenhouse tiles never dry.
- The growth check for a night reads the watered flag from before the reset. Water given during day D
  counts for the night D to D+1; the flag set at 06:00 of D+1 counts for the night D+1 to D+2.
- Irrigated (paddy) tiles use a separate state (2) that sprinklers never overwrite (IL `ApplySprinkler @77-97`).
- Rain outdoors waters soil (WIKI; not checked in IL).

Evidence: IL `HoeDirt.dayUpdate @147-203` (retention roll, greenhouse), `HoeDirt.GetFertilizerWaterRetentionChance`
(float constants 0, 0.33, 0.66, 1.0 by tier), `Crop.newDay @68-88` (watered gate).

For Agora: keep. This is the main design choice for "crops grow while I am away". Under this rule a crop grows
one night per watering, so a farm left for three days with no sprinkler or retention fertilizer does not grow.
The ADR acceptance says crops grow while the owner is away, so pick one of: (a) sprinklers and retention
fertilizer are the offline mechanism (recommended, matches the game); (b) an explicit "watered until the next
visit" flag from a special item. Decide at checkpoint M. Store the watered flag per cell.

## 5. Fertilizer and growth speed

Rule:
- Fertilizer has three tiers. Each tier sets a growth speed bonus, a water retention chance and a quality
  level (section 6): speed 0.10, 0.25, 0.33; retention 0.33, 0.66, 1.0; quality level 1, 2, 3.
- Growth boost `b` = tier speed, plus 0.25 if the crop is on irrigated soil, plus 0.10 if the farmer has the
  farming profession that improves growth.
- Days removed `R = ceil(total days x b)`. Remove one day at a time from phases longer than one day, going
  through the phases in order for at most three sweeps. The final open-ended phase is never shortened.
- The bonus is applied when the crop is planted (partial: call site not checked; WIKI says growth bonuses are
  listed per crop).

Evidence: IL `HoeDirt.GetFertilizerSpeedBoost @92-115` (0, 0.10, 0.25, 0.33 float constants),
`HoeDirt.applySpeedIncreases @0-360` (paddy +0.25 at 137-144; profession check at 145-157 adds 0.10; ceil at
167-178; reduction loop 188-347), `HoeDirt.GetFertilizerQualityBoostLevel @92-99` (returns 1, 2, 3, 0).

For Agora: keep the form with our numbers. Speed and retention are fields on the fertilizer items:
`fertilizer {speedPct, retentionPct, qualityLevel}`. Whole-day rounding (ceil) makes short crops benefit more
from the same percentage, which is acceptable.

## 6. Harvest quality and yield

Rule:
- Quality is rolled once per harvest. The roll is seeded by tile, the current day and the save's unique id
  (IL `Crop.harvest @878-930`), so it is the same for the same tile on the same day. This keeps it
  deterministic for server checks.
- Let `f` = fertilizer quality level (0 to 3) and `FL` = farming level. Let
  `v = 0.2 x FL/10 + 0.2 x f x (FL+2)/12 + 0.01` and `s = min(0.75, 2v)`.
- Best (quality 4) only when `f = 3`: checked first, passes when roll < `v/2`.
- Gold (2): passes when roll < `v`. Only checked when best did not pass.
- Silver (1): passes when roll < `s`, or is guaranteed when `f = 3`.
- Otherwise normal (0).

Single-draw thresholds (gold / silver / best), before the higher-tier check applies:

| fertilizer f | FL 0 | FL 5 | FL 10 |
|---|---|---|---|
| 0 | 1% / 2% / - | 11% / 22% / - | 21% / 42% / - |
| 1 | 4% / 9% / - | 23% / 45% / - | 41% / 75% / - |
| 2 | 8% / 15% / - | 34% / 69% / - | 61% / 75% / - |
| 3 | 11% / 100% (silver or better) / 5.5% | 45% / 100% / 23% | 81% / 100% / 40.5% |

For f = 3 the net gold chance is lower than the table, because best is checked first (at FL 10: 0.595 x 0.81 = 48%).

- Yield: the stack is a random integer from the crop's min to max, plus up to `FL x maxIncreasePerFarmingLevel`,
  plus one extra item with chance `min(0.9, extraChance)` (IL `Crop.harvest @1142-1337`). Values come from data.
- Forage (not crops): a forage profession gives best quality every time. Otherwise gold with chance
  `ForagingLevel / 30`, then silver with chance `ForagingLevel / 15` (IL `GameLocation.GetHarvestSpawnedObjectQuality @0-111`).

Evidence: IL as listed. WIKI Crops confirms only the qualitative rules (fertilizer and farming raise quality; best
needs the top fertilizer), so the numbers are IL-only.

For Agora: adopt the formula as written. Store quality as an int 0, 1, 2, 4 (sell multiplier in section 15). Seed the
roll with the world seed, cell, day and item id.

## 7. Sprinklers

Rule:
- Three tiers. Basic covers the 4 orthogonal neighbours, quality covers the 8 neighbours, the top tier covers the 24
  neighbours of a 5x5 block (IL `Object.GetBaseRadiusForSprinkler @0-55` returns 0, 1, 2; WIKI gives the counts).
  Attaching a range upgrade adds 1 to the radius (IL `Object.GetModifiedRadiusForSprinkler @0-59`).
- Each night, a sprinkler that is outdoors and not in rain queues a watering of every covered tile that is tilled
  and not irrigated (IL `Object.DayUpdate @16-76`, `Object.ApplySprinkler @0-102`).
- Timing: the queued action runs in `handlePostFarmEventActions`, after the crops of that night have grown. Its water
  therefore counts for the next night's growth, the same as hand watering in the morning.
- Costs (WIKI): the basic tier needs farming level 2 and metal bars; the next tier level 6; the top tier level 9.

For Agora: radius and tier per sprinkler in data. Recommend keeping the game's order (water after growth). The ADR
currently says "sprinklers water at 06:00 before growth". That would let a sprinkler crop grow on the same night it is
watered, one day faster than hand watering. This changes ADR-053 and is listed in section 17 for checkpoint M.

## 8. Tools, tiers and energy cost

Rule:
- Tools: hoe, watering can, axe, pickaxe, fishing rod. Each has tiers 0 to 4 (basic to top). Upgrades are paid with
  metal bars at the smith (`ToolUpgradeData` schema: price, trade item, trade amount).
- Area (WIKI): hoe and can cover 1, 3, 5, 9 and 18 tiles by tier. The middle tiers are straight lines of 3 and 5; the
  next is 3x3; the top is 6x3. Watering can capacity (WIKI): 40, 55, 70, 85, 100 charges.
- Energy per use:
  - hoe: `2 x p - 0.1 x FL`, where `p` = 1 for a tap (IL `Hoe.DoFunction @57-83`). Gives 2 at FL 0 and 1 at FL 10
    (WIKI agrees).
  - watering can: `2 x (p + 1) - 0.1 x FL`, where `p` = 0 for a tap, so 2 at FL 0 (IL `WateringCan.DoFunction @202-234`;
    WIKI 2). Conflict: `Farmer.useTool` passes `p = 1`, which would give 4. Section 17.
  - axe and pickaxe: 2 per successful use, 1 on a failed one (WIKI); reduced by their own skill, not farming. Upgrades do
    not change the cost.
  - Tools marked efficient pay no energy (IL `Hoe.DoFunction @52`).
- Energy and area are separate: the area a tool covers does not change its cost (WIKI).

For Agora: `tools.json` per tool and tier: `power` (area), `energyBase` (2 for hoe, can, axe, pickaxe), `energyPerFarmingLevel`
(0.1), `capacity` (can), `shape`. The brief asks for three tiers (wood, iron, diamond) x 4 tools plus a rod: map those to
tiers 1 to 3 and keep tier 0 for the starter tool. The energy formulas stay as above.

## 9. Energy, food, sleep and pass-out

Rule:
- Max energy starts at 270 (IL `Farmer..ctor @1143-1153`, `maxStamina = 270`; WIKI). Energy can fall below 0 down to
  -15. At 0 the farmer is exhausted; below 20 the bar shakes; below 15 a warning shows (IL `Farmer.checkForExhaustion @0-155`;
  WIKI).
- Pass-out: at -15 energy, and in the code at 02:00 (IL clock lambda: time 2600 starts `Farmer.startToPassOut`; WIKI does not
  list a 02:00 pass-out, see section 17). It ends the day. Passing out away from home costs 10% of money, up to 1000 (WIKI).
- Food restores `ceil(2.5 x edibility) + quality x edibility` (IL `Object.staminaRecoveredOnConsumption @43-79`). Two special
  items are fixed values (0, and a full refill; IL `@20-37`). Wiki examples run from about 75 to 240 for the foods the game
  makes.
- Sleep: if in bed by midnight, energy is restored to max. Each 10 minutes after midnight cuts the restore by 2.5 percentage
  points: `r = (min(t, 2600) - 2400) / 400`, so 02:00 gives -50% (WIKI table; IL constants 2400, 2600 and 200 in
  `Farmer.dayupdate @436-554`). Going to bed exhausted cuts a further 50% (WIKI). Energy is never restored below 1 (WIKI).
  A level-up gives full energy the next morning (WIKI).
- IL has a third step at 27:00 (constant 2700 in the same method). Not in the wiki. Open.

For Agora: keep 270, the costs, the food formula and the bedtime table (in game minutes, so it is the same at any
`WORLD_DAY_MS`). Pass-out at -15 or at 02:00 (confirm the 02:00 rule in game). Because a day is longer in real time, check
at checkpoint M whether the energy budget per day feels right.

## 10. Calendar

Rule: four seasons of 28 days, so a year is 112 days (WIKI; `WorldDate` accessors present in IL, constant not extracted).
The new season starts at 06:00 on its first day.

For Agora: `WORLD_SEASON_DAYS = 28`; the catch-up cap of 112 days is one year, as ADR-053 says.

## 11. Animals

Rule (WIKI, with IL constants 70, 225, 255, 1000 and 1200 found in `FarmAnimal.dayUpdate`):
- Friendship 0 to 1000 (100 per half-heart). Daily: petting once +15 (+30 with the matching profession); milking or
  shearing +5; eating grass outside +8; not fed -20; trapped outside overnight -20; not petted -(10 - F/200).
- Mood 0 to 255 (IL cap 255). Petting +32 to +36; fed +4 to +16 (checked at sleep; hay or grass); outside 18:00-19:00 with
  mood under 150 gives +4 to +8 per 10 minutes; outside after 19:00 or in rain -4 to -8 per 10 minutes; not petted -20 to
  -40; not fed -100.
- Production needs an adult that was fed. Chance = mood / 70 when mood is below 70; otherwise certain (IL constant 70).
  Each animal has a product interval (WIKI: daily, every other day, every 3 days, every 4 days, every 7 days).
- Quality of a product needs mood at least 150 (otherwise a mood/150 chance of gaining the ability). Score
  `F/1000 - (1 - mood/225)`, plus 0.333 for the matching profession. Best if score > 0.95 and roll < score/2; gold if
  roll < score/2; silver if roll < score; otherwise normal (IL constants 225, 1000, 0.95, 0.33 in `FarmAnimal.dayUpdate`).
- Large product: friendship at least 200 and `(F + mood x modifier) / 1200 >= 1` (IL constant 1200).
- Hay: one portion per day (grass or hay). Coop animals need 2 grass tufts, barn animals 4, or hay. An animal that is not
  fed does not die; it stops producing and loses mood and friendship (WIKI).

For Agora: four animals (two coop, two barn), each with `daysToMature`, `daysToProduce`, `produce` (normal and better
quality), `feed` (hay or grass), `requiredBuilding`. Use the same rolls. Offline: animals are fed by the owner or from a hay
bin; without feed they stop producing. Pick the offline rule at P17.25.

## 12. Machines and cask aging

Rule:
- A machine holds an input and a timer in minutes. At the day change the timer is reduced by an overnight amount: for one
  night `(2600 - now) + 400` minutes, plus 1600 minutes for each extra night (IL `Utility.CalculateMinutesUntilMorning @0-39`,
  `Object.DayUpdate @774-790`). So a machine started in the evening can finish during the night. partial: the 400 and 1600
  constants are exact, their meaning is a guess.
- Cask aging: an aged item moves to a better quality after 28, 42 and 56 days (IL `Cask.GetDaysForQuality` constants 28,
  42, 56; `Cask.GetNextQuality` returns 1, 2, 4). The quality names are not mapped.
- Processing times and recipe lists are in `Machines.xnb` and `CraftingRecipes.xnb` (not decoded). Wiki values are not used.

For Agora: `recipes.json` entries have `machine`, `inputs`, `outputs`, `minutes` (game minutes) and `overnight: true`. The rule
above is applied to machine timers in `simulateDays`. A cask-like aging rule (28, 42, 56 days) fits our 28-day season if we
want it; it is optional for the first playable.

## 13. NPC friendship and gifts

Rule:
- Hearts: 250 points each (IL `Farmer.getFriendshipHeartLevelForNPC @7`; WIKI). Cap: 10 hearts (2500) for non-romance NPCs;
  WIKI says 2749 for non-marriage candidates (section 17).
- Talking: +20 per NPC per day (IL `NPC.grantConversationFriendship`; WIKI). IL also has a +60 variant behind a buff.
- Gift base points by taste: loved +80, liked +45, neutral +20, disliked -20, hated -40 (IL `NPC.receiveGift` float constants;
  WIKI). Multipliers: birthday x8 (IL 8.0 with `NPC.isBirthday`); a special festival day x5 (WIKI); quality on loved and liked
  gifts only: silver x1.1, gold x1.25, best x1.5 (IL constants 1.1, 1.25, 1.5).
- Limits: one gift per NPC per day; two per NPC per week, weeks start on Sunday (IL `Friendship.GiftsToday`, `GiftsThisWeek`,
  limit 2). Giving two in a week gives +10 on the following Sunday (IL `Farmer.updateFriendshipGifts`, constant 10; WIKI).
- Daily decay when not talked to (IL `Farmer.resetFriendshipsForNewDay @0-356`, constants -20, -8, -2 with thresholds 2500 and
  2000): spouse -20; dating before a bouquet -2 down to 8 hearts; dating after a bouquet -10 (WIKI) or -8 (IL); other NPCs -2
  down to 10 hearts (WIKI). Decay stops when the meter is full.

For Agora: `npc-gifts.json` per NPC with `loved`, `liked`, `neutral`, `disliked`, `hated` lists, `giftsPerDay: 1`,
`giftsPerWeek: 2`, `weekBonus: 10`, `pointsPerHeart: 250`, `cap: 2500`, `talkPoints: 20`, `decayPerDayNotTalked: 2`,
`decayStopsAtPoints: 2500`. Offline: decay is applied per day in `simulateDays`. Recommend a catch-up limit on decay (7 days)
so a week away does not wipe out friendship. That is our design choice, not a game rule.

## 14. Fishing: the bobber bar and bite time

Rule:
- Track: the bar moves inside a 568 px track (IL `BobberBar.update`, constant 568; WIKI). Bar height base 96 px plus 8 px per
  fishing level (WIKI, to 176 at level 10); upgrades add more.
- Catch progress 0 to 1 starts at 0.3 (IL `BobberBar..ctor @30`). While the fish is inside the bar it rises by 0.002 per update;
  outside it falls by 0.003 per update, or by 0.002 with the starter rod, times a penalty modifier (IL `BobberBar.update
  @2613-3212`). At 0 the fish escapes. At 60 updates per second: full in about 8 s, empty in about 6 s.
- Bar control: holding the use button raises the bar. Its speed moves by 0.05 or 0.2 per update depending on direction (IL
  `BobberBar.update @1694-1756`); the full acceleration model is partial.
- Fish: difficulty 5 to 110 from data (WIKI). In the minigame, difficulty scales the target speed and acceleration (partial).
- Bite time: random wait between 0.6 s and 30 s (WIKI). Each fishing level cuts the maximum by 0.25 s (IL
  `FishingRod.calculateTimeUntilFishingBite @0-279`, constant 250 ms per level). Bait halves both bounds, the strongest bait cuts
  67%, and the minimum is 0.5 s (IL constant 500 ms).
- Rods (WIKI): a starter rod that catches only common fish; a second basic rod; then three upgrades at fishing levels 2, 6 and a
  mastery. Upgraded rods do not change bar size.

For Agora: `fish.json` with `difficulty`, `seasons`, `biomes`, `motion`; `rods.json` with `barBasePx: 96`, `barPerLevelPx: 8`,
`trackPx: 568`. Use rates per second so the game is frame-rate independent: fill 0.12/s in the bar and drain 0.18/s out
(0.12/s with the starter rod), derived from the 60 Hz update rate. Bar speed step and cap are to be tuned (game steps 0.05 and 0.2
per update). Bite: minimum 0.5 s, maximum 30 s minus 0.25 s per level.

## 15. Shops, sell prices and forage quality

Rule:
- Selling to the shipping bin pays half the base price (IL `Item.sellToStorePrice`: `salePrice / 2`), multiplied by the quality
  multiplier `1 + 0.25 x quality` (quality 0, 1, 2, 4 give x1.0, x1.25, x1.5, x2.0; IL `Object.sellToStorePrice`). Money is
  credited at 06:00 (section 2).
- Shop buy prices are fixed per item (WIKI; the brief asks for stable prices).
- Forage quality: section 6.

For Agora: `items.json` with `price` (stable shop price), sell = `floor(price / 2)` x quality multiplier, and `category`
(open, limited, restricted, account-bound). No dynamic pricing.

## 16. For Agora: what we keep and what we change

- Keep: the 06:00 day, the 02:00 late limit and the bedtime table, daily growth with the watering gate, out-of-season death,
  regrowth, fertilizer speed and retention rules, the quality formula, the tool energy formulas, 270 energy, the food formula,
  friendship points (250 per heart, +20 for talking, gifts 80/45/20/-20/-40), the fishing bar numbers.
- Change: sprinklers water after growth (section 7), not before. Express all rates per second so they do not depend on frame
  rate. Cap friendship decay on catch-up (section 13). Keep `WORLD_DAY_MS` as the only time knob.
- Decide at checkpoint M: the offline rule for crops (section 4) and animals (section 11), and the 02:00 pass-out (section 9).

## 17. Conflicts between code and wiki, and open items

1. Watering can energy: code gives 4 for a tap if the call path passes `p = 1`; wiki says 2. Starting value 2 (wiki); check in game.
2. Sprinkler order: code applies sprinkler water after growth; ADR-053 says before. Recommend the code order (section 7).
3. Dating decay after a bouquet: code -8, wiki -10. Not used in v1 (no romance).
4. Non-romance friendship cap: wiki 2749 (under 11 hearts), code threshold 2500 (10 hearts). Use 2500.
5. 02:00 pass-out: code starts a pass-out at 2600; wiki lists -50% restore at 02:00 and pass-out at -15 only. Use the code
   rule and confirm in game (checkpoint L).
6. Third bedtime step at 27:00 (code constant 2700, small energy effect): not in the wiki. Left out until checked.
7. Quality numbers: code only; the wiki gives qualitative rules. Confirm by sampling harvests at checkpoint M.
8. Data not extracted: crop days, prices and seasons; fish tables; machine times; recipes; animal intervals (all in XNB,
   LZX-compressed). Our values are chosen by us; wiki values are for sanity only.
9. Not studied: tool area shapes beyond the wiki; multiplayer; weather details; giant crops; cask quality names.

## 18. Starting values (to tune)

| Item | Value | Evidence |
|---|---|---|
| Game minute | 1000 ms at a 20-minute day | section 1 |
| Day start / late limit | 06:00 / 02:00 (26:00) | sections 1, 9 |
| Energy max | 270 | IL Farmer..ctor; WIKI |
| Hoe / can / axe / pick cost | 2 for a tap; -0.1 per farming level | section 8 |
| Food energy | ceil(2.5 x edibility) + quality x edibility | IL Object |
| Fertilizer speed / retention | 0.10, 0.25, 0.33 / 0.33, 0.66, 1.0 | IL HoeDirt |
| Quality v | 0.2 x FL/10 + 0.2 x f x (FL+2)/12 + 0.01 | IL Crop.harvest |
| Sprinkler radius | 0 (4 tiles), 1 (8), 2 (24); upgrade +1 | IL Object; WIKI |
| Friendship per heart / talk / gift | 250 / +20 / 80, 45, 20, -20, -40 | IL NPC, Farmer; WIKI |
| Gifts | 1 per day, 2 per week, +10 bonus | IL; WIKI |
| Bar track / base bar | 568 px / 96 px + 8 per level | IL BobberBar; WIKI |
| Catch rate in / out | +0.002 / -0.003 per update (60 Hz) | IL BobberBar |
| Bite | 0.6 to 30 s, -0.25 s per level, min 0.5 s | WIKI; IL |
| Season / year | 28 days / 112 days | WIKI; ADR-053 |
