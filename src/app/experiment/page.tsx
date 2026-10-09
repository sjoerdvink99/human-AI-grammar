import type { Metadata } from "next";
import { Experiment } from "@/components/experiment/experiment";
import { loadKnownVocabulary } from "@/lib/known-vocabulary";

export const metadata: Metadata = { title: "Experiment" };

export default function ExperimentPage() {
  return <Experiment known={loadKnownVocabulary()} />;
}
