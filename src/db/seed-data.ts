import type { SystemInputJson } from "@/domain/systems/schema";

const seedNote = "Seed record. Verify bibliographic metadata against the published paper.";

export const seedSystems: SystemInputJson[] = [
  {
    paper: {
      title: "DirectGPT: A Direct Manipulation Interface to Interact with Large Language Models",
      authors: ["Damien Masson", "Sylvain Malacria", "Géry Casiez", "Daniel Vogel"],
      year: 2024,
      venue: "CHI",
      citationKey: "masson2024directgpt",
      doi: "10.1145/3613904.3642462",
      url: "https://doi.org/10.1145/3613904.3642462",
      notes: seedNote,
      tags: ["direct manipulation", "text editing", "LLM"],
    },
    system: {
      name: "DirectGPT",
      description:
        "Users point at parts of a generated artifact and issue short instructions; the system translates the selection and instruction into a prompt for the model.",
      processScope: "interaction loop",
    },
    processes: [
      {
        name: "Initial generation",
        rawExpression: `(prompt_1: instruction language)
-> [model generate]~
-> (artifact_1: artifact language)`,
      },
      {
        name: "Select region",
        rawExpression: `(artifact_1: artifact language)
-> [human select]
-> (artifact_1: artifact language) + (region_1: selection spatial)`,
      },
      {
        name: "Specify edit",
        rawExpression: `(artifact_1: artifact language) + (region_1: selection spatial)
-> [human specify]
-> (artifact_1: artifact language) + (region_1: selection spatial) + (instruction_1: instruction language)`,
      },
      {
        name: "Compile prompt",
        rawExpression: `(artifact_1: artifact language) + (region_1: selection spatial) + (instruction_1: instruction language)
-> [tool translate]
-> (artifact_1: artifact language) + (prompt_2: instruction language)`,
      },
      {
        name: "Apply edit",
        rawExpression: `(artifact_1: artifact language) + (prompt_2: instruction language)
-> [model modify]~
-> (artifact_2: artifact language)`,
      },
    ],
  },
  {
    paper: {
      title: "GenTune: Toward Traceable Prompts to Improve Controllability of Image Refinement in Environment Design",
      authors: ["Wen-Fan Wang", "Chien-Ting Lu", "Nil Ponsa Campanyà", "Bing-Yu Chen", "Mike Y. Chen"],
      year: 2025,
      venue: "UIST",
      citationKey: "wang2025gentune",
      notes: seedNote,
      tags: ["image generation", "prompt traceability", "design"],
    },
    system: {
      name: "GenTune",
      description:
        "Designers select image regions, see the prompt labels that produced them, refine those labels, and regenerate the region with an updated prompt.",
      processScope: "interaction loop",
    },
    processes: [
      {
        name: "Generate image",
        rawExpression: `(prompt_1: instruction language)
-> [model generate]~
-> (image_1: artifact visual)`,
      },
      {
        name: "Trace region to prompt",
        rawExpression: `(image_1: artifact visual)
-> [human select]
-> (image_1: artifact visual) + (region_1: selection spatial)
-> [tool match]
-> (region_1: selection spatial) + (labels_1: label language)`,
      },
      {
        name: "Refine labels",
        rawExpression: `(labels_1: label language)
-> [human modify]
-> (labels_2: label language)
-> [tool compose]
-> (prompt_2: instruction language)`,
      },
      {
        name: "Regenerate region",
        rawExpression: `(image_1: artifact visual) + (region_1: selection spatial) + (prompt_2: instruction language)
-> [model modify]~
-> (image_2: artifact visual)`,
      },
    ],
  },
  {
    paper: {
      title: "FlowCo: Rethinking Data Analysis in the Age of LLMs",
      authors: ["Stephen N. Freund", "Brooke Simon", "Emery D. Berger", "Eunice Jun"],
      year: 2025,
      venue: "UIST",
      citationKey: "freund2025flowco",
      notes: seedNote,
      tags: ["data analysis", "dataflow", "code generation"],
    },
    system: {
      name: "FlowCo",
      description:
        "Analysts decompose an analysis into a dataflow graph of natural-language steps; the model generates code per node, which is executed and checked against stated expectations.",
      processScope: "end-to-end workflow",
    },
    processes: [
      {
        name: "Author dataflow",
        rawExpression: `(question_1: instruction language)
-> [human decompose]
-> (graph_1: artifact structured) + (spec_1: instruction language)`,
      },
      {
        name: "Generate and run node",
        rawExpression: `(graph_1: artifact structured) + (spec_1: instruction language)
-> [model generate]~
-> (code_1: artifact formal)
-> [tool execute]
-> (result_1: artifact visual)`,
      },
      {
        name: "Check expectations",
        rawExpression: `(result_1: artifact visual) + (check_1: evaluation language)
-> [model evaluate]~
-> (report_1: evaluation language)`,
      },
      {
        name: "Revise step",
        rawExpression: `(spec_1: instruction language)
-> [human modify]
-> (spec_2: instruction language)
-> [model generate]~
-> (code_2: artifact formal)
-> [tool execute]
-> (result_2: artifact visual)`,
      },
    ],
  },
  {
    paper: {
      title: "Jigsaw: Supporting Designers to Prototype Multimodal Applications by Chaining AI Foundation Models",
      authors: ["David Chuan-En Lin", "Nikolas Martelaro"],
      year: 2024,
      venue: "CHI",
      citationKey: "lin2024jigsaw",
      doi: "10.1145/3613904.3641920",
      url: "https://doi.org/10.1145/3613904.3641920",
      notes: seedNote,
      tags: ["prototyping", "model chaining", "multimodal"],
    },
    system: {
      name: "Jigsaw",
      description:
        "Designers compose puzzle-piece blocks that wrap foundation models into chains, optionally assisted by a model that proposes chains from a task description.",
      processScope: "end-to-end workflow",
    },
    processes: [
      {
        name: "Assisted assembly",
        rawExpression: `(task_1: instruction language)
-> [model_1 decompose]~
-> (plan_1: artifact structured)
-> [human compose]
-> (chain_1: artifact structured)`,
      },
      {
        name: "Configure blocks",
        rawExpression: `(chain_1: artifact structured)
-> [human configure]
-> (chain_2: artifact structured)`,
      },
      {
        name: "Run chain",
        rawExpression: `(chain_2: artifact structured) + (input_1: artifact audio)
-> [model_2 translate]~
-> (transcript_1: artifact language)
-> [model_3 translate]~
-> (image_1: artifact visual)`,
      },
    ],
  },
  {
    paper: {
      title: "Cocoa: Co-Planning and Co-Execution with AI Agents",
      authors: ["K. J. Kevin Feng", "Kevin Pu", "Matt Latzke", "Tal August", "Pao Siangliulue", "Jonathan Bragg", "Daniel S. Weld", "Amy X. Zhang", "Joseph Chee Chang"],
      year: 2024,
      venue: "arXiv",
      citationKey: "feng2024cocoa",
      url: "https://arxiv.org/abs/2412.10999",
      notes: seedNote,
      tags: ["agents", "co-planning", "mixed-initiative"],
    },
    system: {
      name: "CoCoA",
      description:
        "An agent drafts a plan inside a document; users edit the plan, assign steps to themselves or the agent, and review agent outputs step by step.",
      processScope: "end-to-end workflow",
    },
    processes: [
      {
        name: "Co-plan",
        rawExpression: `(task_1: instruction language)
-> [model generate]~
-> (plan_1: artifact structured)
-> [human modify]
-> (plan_2: artifact structured)`,
      },
      {
        name: "Assign steps",
        rawExpression: `(plan_2: artifact structured)
-> [human assign]
-> (plan_2: artifact structured) + (step_1: selection structured)
-> [human delegate]
-> (step_1: selection structured) + (task_2: instruction language)`,
      },
      {
        name: "Co-execute",
        rawExpression: `(step_1: selection structured) + (task_2: instruction language)
-> [model execute]~
-> (output_1: artifact language)
-> [human evaluate]
-> (output_1: artifact language) + (feedback_1: evaluation language)
-> [model modify]~
-> (output_2: artifact language)`,
      },
    ],
  },
  {
    paper: {
      title: "FlowForge: Guiding the Creation of Multi-agent Workflows with Design Space Visualization as a Thinking Scaffold",
      authors: ["Pan Hao", "Dongyeop Kang", "Nicholas Hinds", "Qianwen Wang"],
      year: 2025,
      venue: "IEEE VIS",
      citationKey: "hao2025flowforge",
      notes: seedNote,
      tags: ["multi-agent", "workflow design", "design space"],
    },
    system: {
      name: "FlowForge",
      description:
        "Generated multi-agent workflow alternatives are laid out as a design space; users select and configure a design, then run and evaluate it with agents.",
      processScope: "end-to-end workflow",
    },
    processes: [
      {
        name: "Explore design space",
        rawExpression: `(goal_1: instruction language)
-> [model_1 generate]~
-> (designs_1: artifact structured)
-> [tool translate]
-> (space_1: artifact visual)`,
      },
      {
        name: "Choose design",
        rawExpression: `(space_1: artifact visual)
-> [human select]
-> (space_1: artifact visual) + (design_1: selection structured)
-> [human configure]
-> (workflow_1: artifact structured)`,
      },
      {
        name: "Run workflow",
        rawExpression: `(workflow_1: artifact structured) + (input_1: artifact language)
-> [tool execute]
-> (workflow_1: artifact structured) + (task_1: instruction language)
-> [model_2 execute]~
-> (output_1: artifact language)
-> [model_3 evaluate]~
-> (score_1: evaluation structured)`,
      },
    ],
  },
];
