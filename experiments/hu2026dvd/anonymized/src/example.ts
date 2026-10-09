import type { TextItem } from "../shared/types";

// Example content so every process can be tried without preparing material. Invented for this demo.
export const EXAMPLE = {
  brief:
    "A one-page infographic for a city newsletter explaining why urban beekeeping has grown, what a rooftop hive needs, and how much honey a city hive produces.",
  styleRefs: [
    { id: "s1", title: "Warm editorial", text: "Warm honey yellows (#f2b134), deep charcoal (#2b2d42) and off-white background. Friendly flat illustrations with rounded shapes, generous white space." },
    { id: "s2", title: "Layout", text: "Big headline across the top, one hero illustration on the left, three short facts with small icons on the right, a footnote annotation at the bottom." },
  ] as TextItem[],
  documents: [
    {
      id: "d1",
      title: "Rooftop Hives Report",
      text: "Interest in urban beekeeping has risen steadily over the past decade. Registered city hives in the region grew from 310 in 2015 to 1,240 in 2024. Most new beekeepers cite pollinator decline as their main motivation. A rooftop hive needs a sheltered spot out of strong wind, a nearby water source, and at least six hours of sun per day. City bees forage within a radius of about three kilometres, visiting street trees, parks and balcony gardens.",
    },
    {
      id: "d2",
      title: "Honey Yield Survey",
      text: "The survey measured honey harvested from 85 city hives. The average city hive produced 18 kilograms of honey per season, slightly more than rural hives in the same region, which averaged 15 kilograms. Researchers attribute the difference to the diversity of flowering plants in cities and to warmer urban temperatures that extend the foraging season by about two weeks.",
    },
  ] as TextItem[],
  table: "city,honey_kg_per_hive,hives\nAmsterdam,19,320\nRotterdam,17,210\nUtrecht,18,180\nThe Hague,16,150\nEindhoven,20,120\n",
};
