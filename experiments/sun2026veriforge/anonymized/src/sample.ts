import type { SourceDocument } from "./shared/types";

// Example content written for this prototype (not taken from any external source).
export const sampleDocuments: SourceDocument[] = [
  {
    id: "doc-bleaching",
    title: "Coral bleaching and marine heatwaves",
    text:
      "Coral bleaching occurs when corals expel the symbiotic algae called zooxanthellae that live in their tissues. " +
      "The algae supply up to 90 percent of the coral's energy through photosynthesis. " +
      "Marine heatwaves are the main trigger of mass bleaching: water temperatures about 1 degree Celsius above the summer maximum for several weeks cause corals to expel the algae. " +
      "Scientists measure heat stress with degree heating weeks, a metric published by NOAA Coral Reef Watch. " +
      "Bleached corals are not dead, but they starve if the algae do not return within weeks. " +
      "The Great Barrier Reef experienced mass bleaching in 2016, 2017, 2020, 2022 and 2024.",
  },
  {
    id: "doc-recovery",
    title: "How reefs recover",
    text:
      "Reef recovery depends on coral larvae settling on clean, stable substrate. " +
      "Herbivorous fish such as parrotfish graze on macroalgae and keep surfaces free for larvae. " +
      "Overfishing of herbivores lets macroalgae overgrow the reef and slows recovery. " +
      "Fast-growing branching corals such as Acropora can recover within ten years, while massive corals such as Porites grow only about one centimetre per year. " +
      "Marine protected areas increase herbivore biomass and can improve recovery after bleaching, although they cannot prevent heat stress.",
  },
  {
    id: "doc-acidification",
    title: "Ocean acidification",
    text:
      "The ocean absorbs roughly a quarter of the carbon dioxide emitted by human activity. " +
      "Dissolved carbon dioxide lowers seawater pH and reduces the concentration of carbonate ions. " +
      "Corals need carbonate ions to build their calcium carbonate skeletons, so ocean acidification slows coral calcification. " +
      "Laboratory studies show that acidification and warming together reduce calcification more than either stressor alone. " +
      "Reducing carbon dioxide emissions addresses both ocean warming and ocean acidification.",
  },
];

export const sampleDraft = `Coral reefs are in trouble. When the water gets too warm, corals lose the algae living inside them and turn white, a process called bleaching. Bleached corals are already dead, so every bleaching event permanently destroys part of the reef.

Protecting reefs from fishing is the best way to stop bleaching. Parrotfish keep the reef clean so new corals can settle.

Carbon dioxide also makes the ocean more acidic, which makes it harder for corals to build their skeletons.`;
