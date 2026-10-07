// Local facts from the mockup. `**bold**` markers are split into <b> by LoreBar; never rendered as HTML.
import type { Season } from '@/lib/data/types';

export const LORE: Record<Season, string[]> = {
  halloween: [
    "Every October, costumed storytellers lead the **Historical Haunted Tour** through downtown Truckee.",
    "The **Old Truckee Jail** on Jibboom St held its last guest in 1964. It’s a museum now.",
    "The **Truckee Hotel** and the **Richardson House** both turn up in local ghost stories.",
    "In January 1952 the **City of San Francisco** streamliner sat snowbound near the pass for three days before its 226 passengers were led out.",
    "Truckee was called **Coburn’s Station** until April 1868.",
    "**Summit Tunnel** (1868) was cut through solid granite by hand, mostly by Chinese railroad workers. It still runs above Donner Lake.",
  ],
  christmas: [
    "The Central Sierra Snow Lab on Donner Summit logged **812 inches** of snow in the winter of 1951–52.",
    "Truckee hit **−28 °F** in 1937, and again in 1962.",
    "In 1894 Truckee built the West’s first **ice palace**, right in the middle of town.",
    "**Sugar Bowl** opened in 1939 with California’s first chairlift.",
    "The **1960 Winter Olympics** were held just down Highway 89, at today’s Palisades Tahoe.",
    "The tree lighting by the **1900 train depot** kicks off the season downtown.",
    "After 40 feet of snow in 1866–67, the railroad roofed about **40 miles** of track in wooden snowsheds.",
  ],
};
