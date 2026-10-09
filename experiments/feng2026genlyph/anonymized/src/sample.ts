import { parseCsv } from "./tools/csv.ts";

export const SAMPLES = {
  "fruit-harvest.csv": `fruit,orchard,month,tons
Apple,North,Sep,42
Apple,South,Oct,30
Pear,North,Sep,18
Pear,South,Oct,12
Cherry,North,Jun,9
Cherry,South,Jul,6
Orange,South,Dec,35
Orange,South,Jan,20
Plum,North,Aug,14`,
  "coffee-consumption.csv": `country,cups_per_day,population_m
Finland,4.1,5.5
Norway,3.4,5.4
Netherlands,3.3,17.5
Brazil,2.1,214
Italy,1.6,59
Japan,1.0,125`,
};

export const sampleDataset = (name: keyof typeof SAMPLES) => parseCsv(SAMPLES[name], name);
