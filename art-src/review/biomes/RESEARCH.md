# Biome reference evidence

Observed on 2026-10-12. This pass uses the installed games to check their packaged subject vocabulary, then creates original Agora artwork in the already approved style.

## Local observations

REA `inspect_artifact` successfully inventoried the user's Minecraft 1.21.1 client JAR. It reported 23,519 archive-member occurrences (plus the root), including 3,071 PNG, 8,269 Java class and 10,762 JSON member names. Selected names confirm camel, fox, turtle, sheep and chicken assets; cactus, dead bush, spruce foliage, jungle foliage and bamboo assets; and sandstone and snow materials. The exact artifact SHA-256, evidence identifiers and twelve selected member names are retained in [reference-evidence.json](./reference-evidence.json).

The unmodified 26.6 MB REA response was moved to `test-results/biome-research/minecraft-rea.json`, with its SHA-256 checked before and after the move. The concise evidence file records that response's hash too.

A separate read-only listing of the installed Stardew Valley `Content` directory confirmed farm-animal filenames (cow, chicken, sheep, pig, goat and duck), farm-animal data, wild-tree data, fruit-tree sheets and desert tiles. This was a filename/size catalog, without XNB decoding.

## Inspiration and limits

Minecraft's [official desert article](https://www.minecraft.net/en-us/article/desert), [official biome guide](https://help.minecraft.net/hc/en-us/articles/360046470431-Minecraft-Types-of-Biomes), and [official camel article](https://www.minecraft.net/es-mx/article/camel) support the general desert vocabulary of sand, sandstone, cacti and camels. The installed Stardew catalog supports using familiar farm-animal and botanical categories alongside that biome vocabulary.

Archive names establish that assets are packaged; they do not establish appearances, animation timing, placement code, animal AI or biome spawn rules. No such runtime behavior is claimed to have been reverse engineered. Automatic REA member-format classifications were not treated as semantic evidence. No third-party image was extracted or copied into Agora during this research pass.

Agora's artwork, palette, silhouettes, animation poses and placement implementation are original. Existing Agora artwork and the approved botanical scene served as the visual references. Biome-specific generation prompts and provenance are recorded beside this file.
